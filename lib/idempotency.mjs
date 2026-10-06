/**
 * Idempotency-Key opcional para rotas mutáveis (SQLite em RIPPER_DATA).
 * Chave composta: escopo de auth (RIPPER_TOKEN) + método + path + header.
 * Replay só após resposta finalizada (SSE gravado por completo ao terminar o stream).
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const DEFAULT_TTL_MS = 86_400_000;

let _db;
let _dirKey;

export function idempotencyTtlMs() {
  const raw = process.env.RIPPER_IDEMPOTENCY_TTL_MS;
  if (raw == null || raw === '') return DEFAULT_TTL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return DEFAULT_TTL_MS;
  return Math.floor(n);
}

/** @returns {string|null} null = header ausente */
export function readIdempotencyKey(req) {
  const v = req.headers['idempotency-key'];
  if (v == null || v === '') return null;
  const key = String(v).trim();
  if (!KEY_RE.test(key)) {
    const err = new Error('Idempotency-Key inválida (use 8–128 caracteres [A-Za-z0-9_-]).');
    err.code = 400;
    throw err;
  }
  return key;
}

export function hashRequestBody(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function hashResponseBody(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Escopo estável por token de servidor + rota + chave do cliente. */
export function idempotencyScopeKey(serverToken, method, path, clientKey) {
  const authPart = createHash('sha256').update(String(serverToken || '')).digest('hex').slice(0, 16);
  return `${authPart}|${method}|${path}|${clientKey}`;
}

function sqlitePath() {
  return fileURLToPath(dataUrl('idempotency.sqlite'));
}

function dirKey() {
  return fileURLToPath(dataUrl(''));
}

function spinWaitMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* lock SQLite entre processos */ }
}

function openDb() {
  const key = dirKey();
  if (_db && _dirKey === key) return _db;
  if (_db) {
    try { _db.close(); } catch {}
  }
  mkdirSync(fileURLToPath(dataUrl('')), { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const db = new DatabaseSync(sqlitePath());
      db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS idempotency (
          scope_key TEXT PRIMARY KEY,
          body_hash TEXT NOT NULL,
          state TEXT NOT NULL,
          status_code INTEGER,
          response_headers TEXT,
          response_body BLOB,
          body_fingerprint TEXT,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency(expires_at);
      `);
      _db = db;
      _dirKey = key;
      return _db;
    } catch (err) {
      const busy = err?.code === 'SQLITE_BUSY' || err?.errcode === 5
        || /database is locked/i.test(String(err?.message || err))
        // Windows: dois processos abrindo o mesmo banco novo em WAL dão IOERR transitório.
        || /disk I.O error/i.test(String(err?.message || err));
      if (!busy || attempt === 39) throw err;
      spinWaitMs(Math.min(25 * (attempt + 1), 150));
    }
  }
  return _db;
}

function purgeExpired(db) {
  db.prepare('DELETE FROM idempotency WHERE expires_at < ?').run(Date.now());
}

function rowToRecord(r) {
  if (!r) return null;
  return {
    bodyHash: r.body_hash,
    state: r.state,
    statusCode: r.status_code,
    responseHeaders: r.response_headers ? JSON.parse(r.response_headers) : {},
    responseBody: r.response_body ? Buffer.from(r.response_body) : Buffer.alloc(0),
    bodyFingerprint: r.body_fingerprint || null
  };
}

/**
 * @returns {{ kind: 'proceed' } | { kind: 'replay', record: object } | { kind: 'conflict' } | { kind: 'in_progress' }}
 */
export function beginIdempotency(scopeKey, bodyHash) {
  const db = openDb();
  purgeExpired(db);
  const now = Date.now();
  const expiresAt = now + idempotencyTtlMs();

  return runTxn(db, () => {
    const existing = db.prepare(
      'SELECT scope_key, body_hash, state, status_code, response_headers, response_body, body_fingerprint, expires_at FROM idempotency WHERE scope_key = ?'
    ).get(scopeKey);
    if (existing) {
      if (existing.body_hash !== bodyHash) return { kind: 'conflict' };
      if (existing.state === 'completed') {
        return { kind: 'replay', record: rowToRecord(existing) };
      }
      return { kind: 'in_progress' };
    }
    db.prepare(
      'INSERT INTO idempotency (scope_key, body_hash, state, status_code, response_headers, response_body, body_fingerprint, expires_at) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?)'
    ).run(scopeKey, bodyHash, 'processing', expiresAt);
    return { kind: 'proceed' };
  });
}

export function releaseIdempotency(scopeKey) {
  if (!scopeKey) return;
  const db = openDb();
  runTxn(db, () => {
    db.prepare('DELETE FROM idempotency WHERE scope_key = ? AND state = ?').run(scopeKey, 'processing');
  });
}

export function completeIdempotency(scopeKey, bodyHash, { statusCode, responseHeaders, responseBody }) {
  const db = openDb();
  const fp = hashResponseBody(responseBody);
  const headersJson = JSON.stringify(responseHeaders || {});
  const expiresAt = Date.now() + idempotencyTtlMs();
  runTxn(db, () => {
    db.prepare(`
      UPDATE idempotency SET
        state = 'completed',
        status_code = ?,
        response_headers = ?,
        response_body = ?,
        body_fingerprint = ?,
        expires_at = ?
      WHERE scope_key = ? AND body_hash = ? AND state = 'processing'
    `).run(statusCode, headersJson, responseBody, fp, expiresAt, scopeKey, bodyHash);
  });
  return fp;
}

export function replayIdempotentResponse(res, record, responseHeaders = {}) {
  const merged = { ...(record.responseHeaders || {}), ...responseHeaders };
  if (record.bodyFingerprint) merged['idempotency-fingerprint'] = record.bodyFingerprint;
  res.writeHead(record.statusCode || 200, merged);
  res.end(record.responseBody);
}

/** Captura writeHead/write/end para persistir replay de SSE. */
export function captureResponseBody(res) {
  const chunks = [];
  let statusCode = 200;
  let responseHeaders = {};
  const origWriteHead = res.writeHead.bind(res);
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  res.writeHead = (code, hdrs, ...rest) => {
    statusCode = code;
    responseHeaders = normalizeHeaders(hdrs);
    return origWriteHead(code, hdrs, ...rest);
  };
  res.write = (chunk, ...rest) => {
    if (chunk != null && chunk !== '') {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return origWrite(chunk, ...rest);
  };
  let finalized = null;
  res.end = (chunk, ...rest) => {
    if (chunk != null && chunk !== '') {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    finalized = { statusCode, responseHeaders, responseBody: Buffer.concat(chunks) };
    res.writeHead = origWriteHead;
    res.write = origWrite;
    res.end = origEnd;
    return origEnd(chunk, ...rest);
  };

  return {
    snapshot() {
      return finalized || { statusCode, responseHeaders, responseBody: Buffer.concat(chunks) };
    }
  };
}

function normalizeHeaders(hdrs) {
  if (!hdrs) return {};
  if (Array.isArray(hdrs)) {
    const out = {};
    for (let i = 0; i < hdrs.length; i += 2) out[String(hdrs[i]).toLowerCase()] = String(hdrs[i + 1]);
    return out;
  }
  if (typeof hdrs === 'string') return { 'content-type': hdrs };
  const out = {};
  for (const [k, v] of Object.entries(hdrs)) out[String(k).toLowerCase()] = String(v);
  return out;
}

function runTxn(db, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch {}
      const busy = err?.code === 'SQLITE_BUSY' || /database is locked/i.test(String(err?.message || err));
      if (!busy || attempt === 7) throw err;
      spinWaitMs(Math.min(25 * (attempt + 1), 150));
    }
  }
}

/** Monta contexto para POST /api/chat (ou null se sem header). */
export function chatIdempotencyContext(req, serverToken, rawBody) {
  const clientKey = readIdempotencyKey(req);
  if (!clientKey) return null;
  const bodyHash = hashRequestBody(rawBody);
  const scopeKey = idempotencyScopeKey(serverToken, 'POST', '/api/chat', clientKey);
  const decision = beginIdempotency(scopeKey, bodyHash);
  return {
    scopeKey,
    bodyHash,
    clientKey,
    decision,
    release() { releaseIdempotency(scopeKey); },
    complete(snapshot) { completeIdempotency(scopeKey, bodyHash, snapshot); }
  };
}

/** Só para testes. */
export function _resetIdempotencyForTests() {
  if (_db) {
    try { _db.close(); } catch {}
  }
  _db = undefined;
  _dirKey = undefined;
}

/** Fecha o SQLite de idempotência (shutdown gracioso). */
export function closeIdempotencyStore() {
  if (_db) {
    try { _db.close(); } catch {}
  }
  _db = undefined;
  _dirKey = undefined;
}
