// Histórico do WhatsApp (QR) no Ripper, não na Evolution: retenção, apagar e auditoria ficam sob nosso controle.
// Só grava com o opt-in "Ler conversas" ligado. Só conversas individuais (grupos nunca).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';

export const RETENTION_DAYS = 30;
let _db = null, _key = null;

function openDb() {
  const path = fileURLToPath(dataUrl('whatsapp.sqlite'));
  if (_db && _key === path) return _db;
  mkdirSync(fileURLToPath(dataUrl('')), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS wa_messages (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      from_me INTEGER NOT NULL,
      text TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_phone_at ON wa_messages(phone, at);
    CREATE TABLE IF NOT EXISTS wa_contacts (
      phone TEXT PRIMARY KEY,
      name TEXT,
      last_at INTEGER NOT NULL,
      unread INTEGER NOT NULL DEFAULT 0
    );
  `);
  _db = db; _key = path;
  return db;
}

export function _resetWhatsappStoreForTests() { try { _db?.close(); } catch {} _db = null; _key = null; }

/** Grava uma mensagem (recebida ou enviada por você) e atualiza o contato. Apaga o que passou da retenção. */
export function recordMessage({ id, phone, fromMe, text, name, at = Date.now() }) {
  const db = openDb();
  db.prepare('INSERT OR IGNORE INTO wa_messages (id, phone, from_me, text, at) VALUES (?, ?, ?, ?, ?)').run(String(id), phone, fromMe ? 1 : 0, String(text).slice(0, 8000), at);
  db.prepare(`INSERT INTO wa_contacts (phone, name, last_at, unread) VALUES (?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET name = COALESCE(excluded.name, wa_contacts.name), last_at = MAX(excluded.last_at, wa_contacts.last_at),
    unread = CASE WHEN ? THEN 0 ELSE wa_contacts.unread + 1 END`).run(phone, fromMe ? null : name || null, at, fromMe ? 0 : 1, fromMe ? 1 : 0);
  db.prepare('DELETE FROM wa_messages WHERE at < ?').run(Date.now() - RETENTION_DAYS * 86400_000);
}

export function listChats(limit = 20) {
  return openDb().prepare(`SELECT c.phone, c.name, c.last_at AS lastAt, c.unread,
    (SELECT text FROM wa_messages m WHERE m.phone = c.phone ORDER BY at DESC LIMIT 1) AS last
    FROM wa_contacts c ORDER BY c.last_at DESC LIMIT ?`).all(Math.min(+limit || 20, 100));
}

/** Últimas mensagens de um contato (mais antigas primeiro). Marca a conversa como lida. */
export function readChat(phone, limit = 30) {
  const db = openDb();
  const rows = db.prepare('SELECT from_me AS fromMe, text, at FROM wa_messages WHERE phone = ? ORDER BY at DESC LIMIT ?').all(phone, Math.min(+limit || 30, 200));
  db.prepare('UPDATE wa_contacts SET unread = 0 WHERE phone = ?').run(phone);
  return rows.reverse().map(r => ({ ...r, fromMe: !!r.fromMe }));
}

export function findContacts(query = '', limit = 20) {
  const q = `%${String(query).toLowerCase()}%`;
  return openDb().prepare('SELECT phone, name, last_at AS lastAt FROM wa_contacts WHERE lower(COALESCE(name, \'\')) LIKE ? OR phone LIKE ? ORDER BY last_at DESC LIMIT ?')
    .all(q, `%${String(query).replace(/\D/g, '') || '§'}%`, Math.min(+limit || 20, 100));
}

/**
 * Seu jeito de escrever, a partir das SUAS mensagens enviadas: números simples + exemplos reais
 * (exemplos imitam estilo melhor que descrição). ponytail: sem modelo; trocar por um resumo
 * gerado pelo LLM se os exemplos não bastarem.
 */
export function styleProfile(max = 12) {
  const mine = openDb().prepare('SELECT text FROM wa_messages WHERE from_me = 1 AND length(text) BETWEEN 2 AND 300 ORDER BY at DESC LIMIT 400').all().map(r => r.text);
  if (mine.length < 5) return null;
  const avg = Math.round(mine.reduce((n, t) => n + t.length, 0) / mine.length);
  const share = re => mine.filter(t => re.test(t)).length / mine.length;
  const traits = [
    `mensagens de ~${avg} caracteres`,
    share(/\p{Extended_Pictographic}/u) > 0.2 ? 'usa emojis com frequência' : 'quase não usa emoji',
    share(/^[a-zà-ú]/) > 0.6 ? 'costuma começar em minúscula' : 'começa com maiúscula',
    share(/[.!?]$/) < 0.3 ? 'raramente termina com pontuação' : 'termina frases com pontuação',
    share(/\b(kk+|haha+|rs+)\b/i) > 0.1 ? 'ri com "kkk"/"rs"' : null,
    share(/\b(vc|tb|pq|q|blz|vlw|tmj)\b/i) > 0.15 ? 'usa abreviações (vc, pq, blz…)' : null
  ].filter(Boolean);
  const examples = [...new Set(mine)].slice(0, max);
  return { count: mine.length, traits, examples };
}

export function styleHint(p) {
  if (!p) return '';
  return `\n\nEscreva como o dono deste WhatsApp: ${p.traits.join('; ')}. Exemplos reais de como ele escreve:\n` + p.examples.map(e => `- ${e}`).join('\n');
}

export function stats() {
  const db = openDb();
  return { messages: db.prepare('SELECT count(*) AS n FROM wa_messages').get().n, contacts: db.prepare('SELECT count(*) AS n FROM wa_contacts').get().n };
}

export function wipeHistory() {
  const db = openDb();
  db.exec('DELETE FROM wa_messages; DELETE FROM wa_contacts;');
}
