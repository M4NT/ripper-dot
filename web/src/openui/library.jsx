import { Renderer } from '@openuidev/react-lang';
import { openuiTudo } from '../../../lib/openui-library.mjs';
import '@openuidev/react-ui/components.css';

/** Bloco de resposta visual: desenha os componentes do OpenUI que o modelo escrever no bloco ```openui. */
export function OpenUIBlock({ code, live }) {
  return <div className="oi-bloco"><Renderer response={code} library={openuiTudo} isStreaming={!!live} /></div>;
}

/** Separa o texto em trechos de markdown e blocos ```openui (o bloco pode estar aberto enquanto a resposta chega). */
export function splitOpenUi(src) {
  const out = [];
  const re = /```openui[ \t]*\n?([\s\S]*?)(```|$)/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: 'md', text: src.slice(last, m.index) });
    out.push({ t: 'ui', code: m[1], open: m[2] !== '```' });
    last = re.lastIndex;
    if (!m[0]) break;
  }
  if (last < src.length) out.push({ t: 'md', text: src.slice(last) });
  return out;
}
