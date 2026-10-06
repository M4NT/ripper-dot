// "Exportar tudo": pacote legível (conversas em Markdown, agentes, rotinas, arquivos, artefatos), sem segredos.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { redactRoutine, redactJsonPayload, redactSecretsInText } from './redact.mjs';
import { artifactDownloadName } from './artifacts.mjs';

const safe = s => String(s || 'sem-titulo').replace(/[^\w.\- ()À-ú]/g, '_').slice(0, 80).trim() || 'sem-titulo';
const day = t => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : '');

/** Conversa → Markdown legível. */
export function chatToMarkdown(chat, agentsById = {}) {
  const lines = [`# ${chat.title || 'Conversa'}`, ''];
  if (chat.createdAt) lines.push(`_Criada em ${day(chat.createdAt)}_`, '');
  for (const m of chat.messages || []) {
    if (!['user', 'assistant'].includes(m.role)) continue;
    const who = m.role === 'user' ? 'Você' : agentsById[m.agentId || chat.agentId]?.name || 'Agente';
    lines.push(`## ${who}${m.at ? ` — ${day(m.at)}` : ''}`, '', redactSecretsInText(String(m.content ?? '')), '');
  }
  return lines.join('\n');
}

/**
 * O que vai no pacote: { path, text } ou { path, src } (arquivo copiado do disco).
 * dataPath(rel) → caminho absoluto em RIPPER_DATA; readArtifact(a) → conteúdo.
 */
export async function exportAllEntries(db, { dataPath, readArtifact }) {
  const out = [];
  const used = new Set();
  const uniq = (dir, name) => { let p = `${dir}/${name}`, i = 1; while (used.has(p)) p = `${dir}/${i++}-${name}`; used.add(p); return p; };
  const agentsById = Object.fromEntries((db.agents || []).map(a => [a.id, a]));
  for (const c of db.chats || []) out.push({ path: uniq('conversas', `${safe(c.title)}.md`), text: chatToMarkdown(c, agentsById) });
  for (const a of db.agents || []) {
    const name = safe(a.name);
    out.push({ path: uniq('agentes', `${name}.json`), text: JSON.stringify(redactJsonPayload(a), null, 2) });
    if (a.instructions) out.push({ path: uniq('agentes', `${name}.instrucoes.md`), text: String(a.instructions) });
  }
  if (db.routines?.length) out.push({ path: 'rotinas.json', text: JSON.stringify(db.routines.map(r => redactJsonPayload(redactRoutine(r))), null, 2) });
  for (const f of db.files || []) {
    const src = f.path && dataPath(f.path);
    if (src && existsSync(src)) out.push({ path: uniq('arquivos', safe(f.name)), src });
  }
  for (const a of db.artifacts || []) {
    const text = await readArtifact(a).catch(() => null);
    if (text != null) out.push({ path: uniq('artefatos', artifactDownloadName(a)), text });
  }
  out.push({ path: 'LEIA-ME.txt', text: `Exportação do Ripper — ${day(Date.now())}\nConversas em Markdown, agentes e rotinas em JSON, arquivos e artefatos como estão.\nSenhas, chaves e tokens não entram neste pacote.\n` });
  return out;
}

/** Grava as entradas numa pasta temporária e devolve o caminho (quem chama apaga). */
export function writeEntries(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-export-'));
  for (const e of entries) {
    const p = join(dir, e.path);
    mkdirSync(dirname(p), { recursive: true });
    if (e.src) copyFileSync(e.src, p); else writeFileSync(p, e.text, 'utf8');
  }
  return dir;
}

export const removeDir = dir => rmSync(dir, { recursive: true, force: true });
