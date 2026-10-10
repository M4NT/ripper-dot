import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { endScrollTop, lowerBound, nearEnd, prefixHeights, visibleRange } from '../web/src/ui/virtualRange.js';
import { FOCUSABLE, focusables, trapTab } from '../web/src/ui/focusTrap.js';
import { BP_PHONE, BP_TABLET, QUERY } from '../web/src/ui/breakpoints.js';

const src = nome => readFileSync(fileURLToPath(new URL('../web/src/' + nome, import.meta.url)), 'utf8');
const tokensCss = src('tokens.css');
const uiJsx = src('ui.jsx');
const emptySrc = src('ui/state/EmptyState.jsx');
const skelSrc = src('ui/state/Skeleton.jsx');

function hexTokens(bloco) {
  const out = {};
  for (const m of bloco.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
}
function rgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const claro = hexTokens(/:root \{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] || '');
const escuro = hexTokens(/:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] || '');

test('tokens.css declara cores, raios, espaços e tipografia do §3.1', () => {
  assert.equal(claro.bg, '#ffffff');
  assert.equal(escuro.bg, '#070707');
  assert.equal(escuro.side, '#111111');
  assert.equal(escuro.bubble, '#2c2c2c');
  assert.equal(escuro.composer, '#303030');
  assert.match(tokensCss, /--r-xl:\s*22px/);
  assert.match(tokensCss, /--raio-cartao:\s*16px/);
  assert.match(tokensCss, /--space-4:\s*16px/);
  assert.match(tokensCss, /--font:.*Geist/);
  assert.match(tokensCss, /--bp-phone:\s*640px/);
  assert.match(tokensCss, /--bp-tablet:\s*1100px/);
});

for (const [nome, dados] of [['claro', claro], ['escuro', { ...claro, ...escuro }]]) {
  test(`contraste dos tokens no tema ${nome} (≥ 4,5:1)`, () => {
    const fails = [];
    for (const fg of ['ink', 'ink-2', 'muted', 'faint']) {
      for (const bg of ['bg', 'side', 'surface', 'surface-2', 'chip', 'bubble', 'composer']) {
        if (!dados[fg] || !dados[bg]) continue;
        const r = ratio(dados[fg], dados[bg]);
        if (r < 4.5) fails.push(`${fg} ${dados[fg]} sobre ${bg} ${dados[bg]}: ${r.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(fails, []);
  });
}

test('ui.jsx reexporta os primitivos novos e a API antiga', () => {
  for (const nome of ['Skeleton', 'EmptyState', 'ErrorState', 'Card', 'BottomSheet', 'VirtualList']) {
    assert.match(uiJsx, new RegExp(`export \\{ ${nome} \\}`));
  }
  assert.match(emptySrc, /export function EmptyState\(\{ title, body, action/);
  assert.match(skelSrc, /export function Skeleton\(\{ rows = 3, label = 'Carregando'/);
});

test('EmptyState antigo continua com as classes .empty', () => {
  assert.match(emptySrc, /className=\{className \? 'empty ' \+ className : 'empty'\}/);
  assert.match(emptySrc, /className="empty-title"/);
  assert.match(emptySrc, /className="empty-body"/);
});

test('ErrorState tem retry, detalhe recolhível e aria-live', () => {
  const srcErro = src('ui/state/ErrorState.jsx');
  assert.match(srcErro, /Tentar de novo/);
  assert.match(srcErro, /<details/);
  assert.match(srcErro, /aria-live="assertive"/);
  assert.match(srcErro, /role="alert"/);
});

test('BottomSheet tem Esc, arrastar, foco preso e 100dvh', () => {
  const sheet = src('ui/BottomSheet.jsx');
  assert.match(sheet, /Escape/);
  assert.match(sheet, /trapTab/);
  assert.match(sheet, /onPointerDown/);
  assert.match(sheet, /100dvh|ui-sheet-root/);
  assert.match(sheet, /safe-area-inset-bottom|ui-sheet/);
  assert.match(src('styles/telas/ui-state.css'), /100dvh/);
});

test('VirtualList usa key estável, altura medida e âncora no fim', () => {
  const list = src('ui/VirtualList.jsx');
  assert.match(list, /followEnd/);
  assert.match(list, /visibleRange/);
  assert.match(list, /item\.id/);
  assert.match(list, /ResizeObserver/);
});

test('visibleRange de 10.000 itens só devolve a janela visível', () => {
  const items = Array.from({ length: 10_000 }, (_, i) => ({ id: i }));
  const getKey = item => item.id;
  const measured = new Map();
  const estimate = 40;
  const r = visibleRange({
    items, getKey, measured, estimate,
    scrollTop: 200_000, viewport: 400, overscan: 6,
  });
  assert.equal(r.total, 400_000);
  assert.ok(r.end - r.start <= 30, `janela grande demais: ${r.end - r.start}`);
  assert.ok(r.start >= 4990 && r.start <= 5010, `start=${r.start}`);
  const baixo = visibleRange({ items, getKey, measured, estimate, scrollTop: 399_600, viewport: 400, overscan: 4 });
  assert.equal(baixo.end, 10_000);
  assert.ok(nearEnd(399_600, 400_000, 400));
  assert.equal(endScrollTop(400_000, 400), 399_600);
});

test('visibleRange respeita altura variável medida', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const measured = new Map([['a', 20], ['b', 200], ['c', 20], ['d', 20]]);
  const r = visibleRange({
    items, getKey: x => x.id, measured, estimate: 20,
    scrollTop: 20, viewport: 80, overscan: 0,
  });
  assert.deepEqual([r.start, r.end, r.offset], [1, 2, 20]);
  assert.equal(r.total, 260);
});

test('prefixHeights e lowerBound são consistentes', () => {
  const items = [{ id: 0 }, { id: 1 }, { id: 2 }];
  const prefix = prefixHeights(items, x => x.id, new Map(), 10);
  assert.deepEqual(prefix, [0, 10, 20, 30]);
  assert.equal(lowerBound(prefix, 0), 0);
  assert.equal(lowerBound(prefix, 10), 1);
  assert.equal(lowerBound(prefix, 29), 2);
});

test('nearEnd solta a âncora quando a pessoa sobe', () => {
  assert.equal(nearEnd(0, 1000, 200), false);
  assert.equal(nearEnd(800, 1000, 200), true);
});

test('trapTab cicla o foco e FOCUSABLE cobre controles', () => {
  const calls = [];
  const first = { hidden: false, getAttribute: () => null, focus() { calls.push('first'); } };
  const last = { hidden: false, getAttribute: () => null, focus() { calls.push('last'); } };
  const root = {
    querySelectorAll: () => [first, last],
    contains: el => el === first || el === last,
    focus() { calls.push('root'); },
  };
  assert.deepEqual(focusables(root), [first, last]);
  const ev = (key, shiftKey, target) => {
    let prevented = false;
    const e = { key, shiftKey, target, preventDefault() { prevented = true; } };
    return { e, prevented: () => prevented };
  };
  const tab = ev('Tab', false, last);
  assert.equal(trapTab(tab.e, root), true);
  assert.equal(tab.prevented(), true);
  assert.deepEqual(calls, ['first']);
  const shift = ev('Tab', true, first);
  assert.equal(trapTab(shift.e, root), true);
  assert.deepEqual(calls, ['first', 'last']);
  assert.match(FOCUSABLE, /button/);
  assert.equal(BP_PHONE, 640);
  assert.equal(BP_TABLET, 1100);
  assert.match(QUERY.phone, /640/);
});

test('exemplos cobrem os seis primitivos', () => {
  const ex = src('ui/examples.jsx');
  for (const nome of ['Skeleton', 'EmptyState', 'ErrorState', 'Card', 'BottomSheet', 'VirtualList']) {
    assert.match(ex, new RegExp(`<${nome}\\b`));
  }
  assert.match(ex, /10_000|10000/);
});
