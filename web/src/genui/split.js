/** Separa markdown, blocos ```openui e ```genui (o bloco pode estar aberto no streaming). */
export function splitChatVisual(src) {
  const out = [];
  const re = /```(openui|genui)[ \t]*\n?([\s\S]*?)(```|$)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: 'md', text: src.slice(last, m.index) });
    out.push({ t: m[1], code: m[2], open: m[3] !== '```' });
    last = re.lastIndex;
    if (!m[0]) break;
  }
  if (last < src.length) out.push({ t: 'md', text: src.slice(last) });
  return out;
}
