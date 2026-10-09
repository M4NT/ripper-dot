// Verifica o contraste de texto nos dois temas, lendo as cores direto do CSS da interface (styles.css e web/src/styles/telas/).
// Regra: texto normal precisa de 4,5:1 (WCAG AA). Uso: node scripts/contraste.mjs
// Sai com código 1 se algum par ficar abaixo do mínimo, para servir de guarda no CI.
import { lerCssDaInterface } from '../lib/css-interface.mjs';

const css = lerCssDaInterface();

/** Pega os valores de variáveis de um bloco de regra (ex.: ":root { ... }"). */
function variaveis(bloco) {
  const out = {};
  for (const m of bloco.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[m[1]] = m[2];
  return out;
}
const claro = variaveis(/:root \{([\s\S]*?)\n\}/.exec(css)?.[1] || '');
const escuro = variaveis(/:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n\}/.exec(css)?.[1] || '');
const base = { ...claro };
const tema = (dados) => ({ ...base, ...dados });

function hexParaRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function luminancia(hex) {
  const canais = hexParaRgb(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}
const contraste = (a, b) => { const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };

// Pares de texto sobre superfície que o app usa
const PARES = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink-2', 'bg'], ['ink-2', 'surface'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
  ['faint', 'bg'], ['faint', 'surface'],
  ['ok', 'bg'], ['warn', 'bg'], ['err', 'bg'],
];

let falhas = 0;
for (const [nome, dados] of [['claro', claro], ['escuro', escuro]]) {
  const v = tema(dados);
  console.log(`\nTema ${nome}`);
  for (const [texto, fundo] of PARES) {
    if (!v[texto] || !v[fundo]) { console.log(`  (faltou --${texto} ou --${fundo})`); continue; }
    const r = contraste(v[texto], v[fundo]);
    const ok = r >= 4.5;
    if (!ok) falhas++;
    console.log(`  ${ok ? 'ok  ' : 'FALHA'} --${texto} sobre --${fundo}: ${r.toFixed(2)}:1`);
  }
}
console.log(falhas ? `\n${falhas} par(es) abaixo de 4,5:1.` : '\nTodos os pares de texto passam de 4,5:1.');
process.exit(falhas ? 1 : 0);
