import { readFile } from 'node:fs/promises';
import { dataUrl } from './store.mjs';
import { canUseFile } from './agent-flow.mjs';

export const MAX_ATTACHMENTS = 10;
export const MAX_FOLDER_FILES = 80;

const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;
const TEXT_EXT = /\.(txt|md|csv|tsv|json|jsonl|xml|html|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|sql|yaml|yml|toml|ini|log|sh|patch|diff|eml)$/i;

/**
 * Resolve anexos de uma mensagem: texto inline, imagens base64 e avisos honestos.
 * @returns {{ text: string, images: object[], skipped: string[], missing: string[] }}
 */
export async function buildMessageAttachments(db, agent, chat, fileIds = []) {
  const parts = [], images = [], skipped = [], missing = [];
  const ids = [...new Set(fileIds)].slice(0, MAX_ATTACHMENTS);
  if (fileIds.length > MAX_ATTACHMENTS) {
    skipped.push(`Só os primeiros ${MAX_ATTACHMENTS} anexos entram no prompt (${fileIds.length} enviados).`);
  }
  for (const fid of ids) {
    const f = db.files.find(x => x.id === fid);
    if (!f) { missing.push(fid); continue; }
    if (!canUseFile(f, agent, chat)) {
      skipped.push(`${f.name}: sem permissão nesta conversa.`);
      continue;
    }
    let buf;
    try {
      buf = await readFile(dataUrl(f.path));
    } catch {
      missing.push(f.name);
      continue;
    }
    if (TEXT_EXT.test(f.name) && f.size < 200_000) {
      parts.push(`<arquivo nome="${f.name}">
${buf.toString('utf8')}
</arquivo>`);
    } else if (IMAGE_TYPES.test(f.type) && f.size <= 5 << 20) {
      images.push({ name: f.name, mediaType: f.type, path: f.path, data: buf.toString('base64') });
    } else {
      parts.push(`<arquivo nome="${f.name}" tipo="${f.type}" tamanho="${f.size}">Arquivo binário anexado (${f.size} bytes).</arquivo>`);
    }
  }
  return { text: parts.join('\n'), images, skipped, missing };
}

export function attachmentWarnings({ skipped, missing }) {
  const lines = [];
  if (missing.length) lines.push(`Anexo(s) não encontrado(s) ou removido(s): ${missing.join(', ')}.`);
  if (skipped.length) lines.push(...skipped);
  return lines;
}
