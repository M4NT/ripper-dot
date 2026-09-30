// Markdown enxuto e seguro: escapa todo o texto antes de aplicar formatação.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

/** Durante a digitação, esconde marcações ainda não fechadas (um ** ou ` pela metade). */
export function closeOpen(text) {
  let t = text;
  if ((t.match(/\*\*/g) || []).length % 2) { const i = t.lastIndexOf('**'); t = t.slice(0, i) + t.slice(i + 2); }
  const outsideFences = t.replace(/```[\s\S]*?```/g, '');
  if ((t.match(/```/g) || []).length % 2 === 0 && (outsideFences.match(/`/g) || []).length % 2) { const i = t.lastIndexOf('`'); t = t.slice(0, i) + t.slice(i + 1); }
  return t.replace(/\*$/, '');
}

/** Texto puro para prévias (listas, barra lateral). */
export const plain = s => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();

export function markdown(src) {
  const blocks = [];
  let s = String(src).replace(/```([\w+-]*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<div class="code"><div class="code-head"><span>${esc(lang || 'código')}</span><button type="button" data-copy>${COPY}Copiar</button></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = esc(s);
  const inline = t => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    // Negrito sem par (ex.: resposta cortada) some, nunca aparece como ** na tela.
    .replace(/\*\*/g, '');
  const out = [];
  let list = null, para = [];
  const flushList = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; } };
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^\u0000(\d+)\u0000$/))) { flushPara(); flushList(); out.push(blocks[m[1]]); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flushPara(); flushList(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    if ((m = line.match(/^\s*([-*•]|\d+\.)\s+(.*)/))) { flushPara(); const t = /\d/.test(m[1]) ? 'ol' : 'ul'; if (list?.t !== t) { flushList(); list = { t, items: [] }; } list.items.push(m[2]); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^&gt;\s?(.*)/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if (/^\|.*\|$/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
      flushPara(); flushList();
      const row = (l, tag) => `<tr>${l.slice(1, -1).split('|').map(c => `<${tag}>${inline(c.trim())}</${tag}>`).join('')}</tr>`;
      let html = `<div class="table"><table><thead>${row(line, 'th')}</thead><tbody>`;
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) html += row(lines[i++], 'td');
      i--; out.push(html + '</tbody></table></div>'); continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, n) => blocks[n]);
}
