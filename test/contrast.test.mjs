import test from 'node:test';
import assert from 'node:assert/strict';
import { lerCssDaInterface } from '../lib/css-interface.mjs';

// Lê as variáveis de cor do CSS da interface na ordem em que o navegador aplica (o que vem depois ganha)
const css = lerCssDaInterface();
function tokens(theme) {
  const out = {};
  for (const m of css.matchAll(/(:root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\))?)\s*\{([^}]*)\}/g)) {
    const dark = m[1] !== ':root';
    if (dark && theme !== 'dark') continue;
    for (const d of m[2].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi)) out[d[1]] = d[2];
  }
  return out;
}
const rgb = hex => { let h = hex.slice(1); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
const lum = hex => { const [r, g, b] = rgb(hex).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const theme of ['light', 'dark']) {
  test(`contraste do texto no tema ${theme === 'dark' ? 'escuro' : 'claro'} (WCAG AA, 4,5:1)`, () => {
    const t = tokens(theme);
    const fails = [];
    for (const fg of ['ink', 'ink-2', 'muted', 'faint']) {
      for (const bg of ['bg', 'side', 'surface', 'surface-2', 'chip']) {
        if (!t[fg] || !t[bg]) continue;
        const r = ratio(t[fg], t[bg]);
        if (r < 4.5) fails.push(`${fg} ${t[fg]} sobre ${bg} ${t[bg]}: ${r.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(fails, []);
  });
}
