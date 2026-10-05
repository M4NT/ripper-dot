// Busca em texto completo na Biblioteca: artefatos, arquivos de texto, memórias e skills.
// Sem acento/maiúscula; todas as palavras precisam aparecer; título vale mais que o corpo.
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Trecho de ~160 caracteres em volta da primeira palavra encontrada. */
export function snippet(text, words, width = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const f = fold(t);
  const at = Math.min(...words.map(w => f.indexOf(w)).filter(i => i >= 0));
  if (!Number.isFinite(at)) return t.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  return (start > 0 ? '…' : '') + t.slice(start, start + width) + (start + width < t.length ? '…' : '');
}

/** items: [{ kind, id, title, text, href, at }] → os que casam, mais relevantes primeiro. */
export function searchLibrary(items, query, limit = 50) {
  const words = fold(query).split(/\s+/).filter(w => w.length >= 2);
  if (!words.length) return [];
  const out = [];
  for (const it of items) {
    const title = fold(it.title), body = fold(it.text);
    if (!words.every(w => title.includes(w) || body.includes(w))) continue;
    const score = words.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0);
    out.push({ kind: it.kind, id: it.id, title: it.title, href: it.href, at: it.at, score, snippet: snippet(it.text || it.title, words) });
  }
  return out.sort((a, b) => b.score - a.score || (b.at || 0) - (a.at || 0)).slice(0, limit);
}
