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

/**
 * Números escritos com ponto ou vírgula de milhar viram o formato do Brasil: 2000.5 -> 2.000,50; 1,234.56 -> 1.234,56.
 * Versões e datas não entram (precisam de 4 dígitos antes do ponto, sem ponto depois de três casas).
 */
export function ptNumeros(t) {
  return t
    .replace(/(?<![\w./:,-])(\d{1,3}(?:,\d{3})+)\.(\d{2})(?![\w./:-])/g, (_, i, d) => `${i.replace(/,/g, '.')},${d}`)
    .replace(/(?<![\w./:,-])(\d{4,})\.(\d{1,2})(?![\w./:-])/g, (_, i, d) => `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d.padEnd(2, '0')}`);
}

/** Títulos do texto, na mesma ordem em que markdown() os numera (h0, h1, …). Para o índice da resposta. */
export function titulosDo(src) {
  const sem = String(src).replace(/```[\s\S]*?(```|$)/g, '');
  const out = [];
  for (const line of sem.split('\n')) {
    const m = line.match(/^(#{1,3})\s+(.*)/);
    if (m) out.push({ id: `h${out.length}`, nivel: m[1].length, texto: plain(m[2]) });
  }
  return out;
}

export function markdown(src, prefix = '') {
  const blocks = [];
  let hn = 0; // títulos numerados em ordem: a âncora de cada um é ${prefix}h${n}
  let s = String(src).replace(/```([\w+-]*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<div class="code"><div class="code-head"><span>${esc(lang || 'código')}</span><button type="button" data-copy>${COPY}Copiar</button></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = esc(s);
  const inline = t => t.split(/(`[^`]*`)/).map((seg, i) => (i % 2 ? seg : ptNumeros(seg))).join('')
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
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flushPara(); flushList(); const n = m[1].length + 1; out.push(`<h${n} id="${prefix}h${hn++}">${inline(m[2])}</h${n}>`); continue; }
    if ((m = line.match(/^\s*([-*•]|\d+\.)\s+(.*)/))) { flushPara(); const t = /\d/.test(m[1]) ? 'ol' : 'ul'; if (list?.t !== t) { flushList(); list = { t, items: [] }; } list.items.push(m[2]); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^&gt;\s?(.*)/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if (/^\|.*\|$/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
      flushPara(); flushList();
      const row = (l, tag) => `<tr>${l.slice(1, -1).split('|').map(c => `<${tag}>${inline(c.trim())}</${tag}>`).join('')}</tr>`;
      // Guarda o texto original (já escapado) da tabela, para copiar como Markdown ou CSV.
      const bruto = [line, lines[i + 1]];
      let corpo = '';
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) { bruto.push(lines[i]); corpo += row(lines[i++], 'td'); }
      i--;
      out.push(`<div class="table" data-table="${bruto.join('\n')}"><div class="table-tools"><button type="button" class="link" data-copy-table="md">Copiar como Markdown</button><button type="button" class="link" data-copy-table="csv">Copiar como CSV</button><button type="button" class="link tabela-expandir" data-expand-table>Tela cheia</button></div><div class="table-scroll"><table><thead>${row(line, 'th')}</thead><tbody>${corpo}</tbody></table></div></div>`);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, n) => blocks[n]);
}

/** Tabela em Markdown (texto original) -> CSV com ";", que o Excel em português abre direto. */
export function tabelaParaCsv(raw) {
  const linhas = String(raw || '').split('\n').filter(Boolean);
  const celulas = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const campo = c => (/[";\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return linhas.filter((_, i) => i !== 1).map(l => celulas(l).map(campo).join(';')).join('\n');
}
