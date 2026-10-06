import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
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
    const txt = f.size < 2_000_000 ? fileText(f.name, buf) : null;
    if (txt != null) {
      parts.push(`<arquivo nome="${f.name}">
${txt}
</arquivo>`);
    } else if (IMAGE_TYPES.test(f.type) && f.size <= 5 << 20) {
      images.push({ name: f.name, mediaType: f.type, path: f.path, data: buf.toString('base64') });
    } else {
      parts.push(`<arquivo nome="${f.name}" tipo="${f.type}" tamanho="${f.size}">Arquivo binário anexado (${f.size} bytes).</arquivo>`);
    }
  }
  return { text: parts.join('\n'), images, skipped, missing };
}

/** Lê arquivos do zip (xlsx/docx) só com zlib: central directory → entradas pedidas. */
function unzip(buf, want) {
  const out = {};
  let e = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (e < 0) return out;
  let p = buf.readUInt32LE(e + 16);
  for (let n = buf.readUInt16LE(e + 10); n--;) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen), local = buf.readUInt32LE(p + 42);
    if (want(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Texto de um arquivo para o prompt: texto puro, planilha xlsx (CSV por aba) ou docx. null = binário. */
export function fileText(name, buf, max = 200_000) {
  let t = null;
  try {
    if (TEXT_EXT.test(name)) t = buf.toString('utf8');
    else if (/\.xlsx$/i.test(name)) {
      const z = unzip(buf, n => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
      const shared = [...(z['xl/sharedStrings.xml'] || '').matchAll(/<si>([^]*?)<\/si>/g)].map(m => xmlText([...m[1].matchAll(/<t[^>]*>([^]*?)<\/t>/g)].map(x => x[1]).join('')));
      const names = [...(z['xl/workbook.xml'] || '').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(m => xmlText(m[1]));
      const csv = v => /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      t = Object.keys(z).filter(k => k.includes('worksheets/')).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/))).map((k, i) => {
        const rows = [...z[k].matchAll(/<row[^>]*>([^]*?)<\/row>/g)].map(r => {
          const cells = [];
          for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([^]*?)<\/c>)/g)) {
            const col = [...c[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
            const v = c[3]?.match(/<v>([^]*?)<\/v>/)?.[1] ?? c[3]?.match(/<t[^>]*>([^]*?)<\/t>/)?.[1] ?? '';
            cells[col] = csv(/t="s"/.test(c[2]) ? shared[+v] ?? '' : xmlText(v));
          }
          return Array.from(cells, x => x ?? '').join(',');
        });
        return `# Aba: ${names[i] || k}\n${rows.join('\n')}`;
      }).join('\n\n');
    } else if (/\.docx$/i.test(name)) {
      const doc = unzip(buf, n => n === 'word/document.xml')['word/document.xml'] || '';
      t = xmlText(doc.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
    }
  } catch { return null; }
  return t != null && t.length > max ? t.slice(0, max) + '\n[… cortado]' : t;
}

export function attachmentWarnings({ skipped, missing }) {
  const lines = [];
  if (missing.length) lines.push(`Anexo(s) não encontrado(s) ou removido(s): ${missing.join(', ')}.`);
  if (skipped.length) lines.push(...skipped);
  return lines;
}
