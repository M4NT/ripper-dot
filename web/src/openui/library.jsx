import { useEffect, useRef } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { openuiTudo } from '../../../lib/openui-library.mjs';
import '@openuidev/react-ui/components.css';

// Tabela do OpenUI: lê o que está na tela (cabeçalho e linhas) e copia como Markdown ou CSV.
function dadosDaTabela(tabela) {
  const linhas = [...tabela.querySelectorAll('tr')].map(tr => [...tr.children].map(c => c.textContent.trim().replace(/\s+/g, ' ')));
  return linhas.filter(l => l.length);
}
const emMarkdown = linhas => {
  if (!linhas.length) return '';
  const cabeca = '| ' + linhas[0].join(' | ') + ' |';
  const sep = '|' + linhas[0].map(() => '---').join('|') + '|';
  return [cabeca, sep].concat(linhas.slice(1).map(l => '| ' + l.join(' | ') + ' |')).join('\n');
};
const emCsv = linhas => linhas.map(l => l.map(c => (/[";\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n');

/** Bloco de resposta visual: desenha os componentes do OpenUI que o modelo escrever no bloco ```openui. */
export function OpenUIBlock({ code, live }) {
  const ref = useRef(null);
  // Botões de copiar ficam logo acima de cada tabela. São recriados a cada mudança do bloco (o streaming muda o código).
  useEffect(() => {
    const raiz = ref.current;
    if (!raiz) return;
    raiz.querySelectorAll('.oi-copia').forEach(n => n.remove());
    raiz.querySelectorAll('table').forEach(tabela => {
      const barra = document.createElement('div');
      barra.className = 'oi-copia table-tools';
      for (const [rotulo, formato] of [['Copiar como Markdown', 'md'], ['Copiar como CSV', 'csv']]) {
        const botao = document.createElement('button');
        botao.type = 'button'; botao.className = 'link'; botao.textContent = rotulo;
        botao.onclick = () => {
          const linhas = dadosDaTabela(tabela);
          navigator.clipboard.writeText(formato === 'csv' ? emCsv(linhas) : emMarkdown(linhas));
          botao.textContent = 'Copiado'; setTimeout(() => { botao.textContent = rotulo; }, 1400);
        };
        barra.appendChild(botao);
      }
      tabela.parentElement.insertBefore(barra, tabela);
    });
  });
  return <div className="oi-bloco" ref={ref}><Renderer response={code} library={openuiTudo} isStreaming={!!live} /></div>;
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
