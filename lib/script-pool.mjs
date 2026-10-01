// Context Pool: scripts que funcionaram, compartilhados entre todos os agentes.
// O agente procura antes de escrever código (find_script) e guarda depois que deu certo (save_script).
// Aprende uma vez, reaproveita sempre: a próxima execução não gasta tokens reescrevendo o mesmo script.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataUrl } from './store.mjs';

let _db = null, _key = null;

function openDb() {
  const path = fileURLToPath(dataUrl('scripts.sqlite'));
  if (_db && _key === path) return _db;
  mkdirSync(fileURLToPath(dataUrl('')), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task TEXT NOT NULL,
      lang TEXT NOT NULL,
      code TEXT NOT NULL,
      notes TEXT,
      agent_id TEXT,
      uses INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(task, lang)
    );
  `);
  _db = db; _key = path;
  return db;
}

export function _resetScriptPoolForTests() { try { _db?.close(); } catch {} _db = null; _key = null; }

const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = s => new Set(norm(s).match(/[a-z0-9]{3,}/g) || []);

/** Guarda (ou atualiza) o script de uma tarefa. Mesma tarefa + linguagem = nova versão no lugar. */
export function saveScript({ task, lang = 'sh', code, notes = '' }, agentId = null) {
  task = String(task || '').trim().slice(0, 200);
  code = String(code || '').slice(0, 20_000);
  if (!task || !code.trim()) throw new Error('Informe a tarefa e o código.');
  const now = Date.now();
  openDb().prepare(`
    INSERT INTO scripts (task, lang, code, notes, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task, lang) DO UPDATE SET code = excluded.code, notes = excluded.notes, agent_id = excluded.agent_id, updated_at = excluded.updated_at
  `).run(task, String(lang).slice(0, 20), code, String(notes).slice(0, 500), agentId, now, now);
  return `Script salvo no pool: "${task}" (${lang}).`;
}

/**
 * Melhores scripts para a tarefa: palavras em comum com a descrição, desempate pelos mais usados.
 * ponytail: varre a tabela inteira em JS; com milhares de scripts, trocar por FTS5.
 */
export function findScripts(query, limit = 3) {
  const q = words(query);
  if (!q.size) return [];
  const rows = openDb().prepare('SELECT id, task, lang, code, notes, uses, updated_at FROM scripts').all();
  return rows
    .map(r => ({ ...r, score: [...words(r.task + ' ' + (r.notes || ''))].filter(w => q.has(w)).length / q.size }))
    .filter(r => r.score >= 0.34)
    .sort((a, b) => b.score - a.score || b.uses - a.uses)
    .slice(0, limit);
}

/** Resposta da ferramenta find_script: conta o uso para o mais relevante aparecer primeiro da próxima vez. */
export function findScriptTool(query) {
  const hits = findScripts(query);
  if (!hits.length) return 'Nenhum script parecido no pool. Escreva um e, se funcionar, guarde com save_script.';
  const inc = openDb().prepare('UPDATE scripts SET uses = uses + 1 WHERE id = ?');
  for (const h of hits) inc.run(h.id);
  return hits.map(h => `### ${h.task} (${h.lang}, usado ${h.uses + 1}x)\n${h.notes ? h.notes + '\n' : ''}\`\`\`${h.lang}\n${h.code}\n\`\`\``).join('\n\n');
}

export function listScripts() {
  return openDb().prepare('SELECT id, task, lang, code, notes, agent_id AS agentId, uses, created_at AS createdAt, updated_at AS updatedAt FROM scripts ORDER BY uses DESC, updated_at DESC').all();
}

export function deleteScript(id) {
  return openDb().prepare('DELETE FROM scripts WHERE id = ?').run(Number(id)).changes > 0;
}
