// Fila de envios (dead-letter): WhatsApp, e-mail e webhooks que falham por problema temporário (rede, servidor
// fora, tempo esgotado) ficam aqui e são tentados de novo sozinhos, com espera crescente. Esgotou ou o erro é
// permanente → "morto": aparece para você reenviar ou descartar. Nada se perde numa queda de rede.
// SQLite em WAL ao lado do db.json (como usage.sqlite).
// ponytail: entrega "pelo menos uma vez" — se o processo cair entre enviar e marcar, pode sair repetido.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { dataUrl } from './store.mjs';

const BACKOFF_MIN = [1, 5, 15, 60, 240]; // espera antes de cada nova tentativa
export const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;

/** Falha que vale tentar de novo (rede, servidor, limite) — o resto é permanente (dado errado, sem permissão). */
export function isTransient(err) {
  const m = String(err?.message || err || '');
  const status = err?.status || +(/\b(?:HTTP|respondeu|status)\s*(\d{3})\b/i.exec(m)?.[1] || 0);
  if (status) return status === 408 || status === 425 || status === 429 || status >= 500;
  return /ECONN(REFUSED|RESET|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|fetch failed|network|timeout|tempo esgotado|sem resposta|aborted|Greeting never received|Connection closed/i.test(m);
}

/** Minutos até a próxima tentativa depois de `attempts` tentativas; null = esgotou. */
export const backoffMs = attempts => attempts < MAX_ATTEMPTS ? BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000 : null;

let _db, _key;
function db() {
  const key = fileURLToPath(dataUrl(''));
  if (_db && _key === key) return _db;
  mkdirSync(key, { recursive: true });
  _db = new DatabaseSync(fileURLToPath(dataUrl('outbox.sqlite')));
  _key = key;
  _db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, target TEXT, label TEXT,
      agent_id TEXT, chat_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL, done_at INTEGER);
    CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_at);`);
  return _db;
}

const row = r => r && ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload), target: r.target, label: r.label, agentId: r.agent_id, chatId: r.chat_id,
  status: r.status, attempts: r.attempts, nextAt: r.next_at, lastError: r.last_error, createdAt: r.created_at, doneAt: r.done_at });

/** Primeira tentativa falhou (attempts = 1). Transitória → pendente; permanente → morta. */
export function enqueue({ kind, payload, target, label, agentId, chatId, error, transient = true, now = Date.now() }) {
  const id = randomUUID();
  const status = transient ? 'pending' : 'dead';
  db().prepare(`INSERT INTO outbox (id, kind, payload, target, label, agent_id, chat_id, status, attempts, next_at, last_error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(id, kind, JSON.stringify(payload), target || null, (label || '').slice(0, 300), agentId || null, chatId || null,
    status, transient ? now + backoffMs(1) : null, String(error || '').slice(0, 500), now);
  return id;
}

export const due = (now = Date.now(), limit = 20) => db().prepare(`SELECT * FROM outbox WHERE status = 'pending' AND next_at <= ? ORDER BY next_at LIMIT ?`).all(now, limit).map(row);
export const get = id => row(db().prepare('SELECT * FROM outbox WHERE id = ?').get(id));
export const list = ({ status, limit = 200 } = {}) => (status
  ? db().prepare('SELECT * FROM outbox WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
  : db().prepare("SELECT * FROM outbox WHERE status IN ('pending','dead') ORDER BY created_at DESC LIMIT ?").all(limit)).map(row);
export const counts = () => Object.fromEntries(db().prepare("SELECT status, COUNT(*) n FROM outbox WHERE status IN ('pending','dead') GROUP BY status").all().map(r => [r.status, r.n]));

export function markSent(id, now = Date.now()) {
  db().prepare("UPDATE outbox SET status = 'sent', done_at = ?, next_at = NULL WHERE id = ?").run(now, id);
}

/** Nova falha. Devolve o status novo ('pending' com nova espera, ou 'dead'). */
export function markFailed(id, err, now = Date.now()) {
  const it = get(id);
  if (!it) return null;
  const attempts = it.attempts + 1;
  const wait = isTransient(err) ? backoffMs(attempts) : null;
  const status = wait ? 'pending' : 'dead';
  db().prepare('UPDATE outbox SET status = ?, attempts = ?, next_at = ?, last_error = ? WHERE id = ?')
    .run(status, attempts, wait ? now + wait : null, String(err?.message || err || '').slice(0, 500), id);
  return status;
}

/** Você mandou reenviar (morta ou pendente): volta para a fila agora, com tentativas zeradas. */
export function retryNow(id, now = Date.now()) {
  return db().prepare("UPDATE outbox SET status = 'pending', attempts = 0, next_at = ? WHERE id = ? AND status IN ('pending','dead')").run(now, id).changes > 0;
}
export function discard(id, now = Date.now()) {
  return db().prepare("UPDATE outbox SET status = 'discarded', done_at = ? WHERE id = ? AND status IN ('pending','dead')").run(now, id).changes > 0;
}
