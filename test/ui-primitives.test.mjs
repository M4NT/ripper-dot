import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  endScrollTop, lowerBound, nearEnd, patchPrefix, pinnedIndices, prefixHeights, prependShift,
  pruneMeasured, scrollCompensation, visibleRange,
} from '../web/src/ui/virtualRange.js';
import { FOCUSABLE, focusables, trapTab } from '../web/src/ui/focusTrap.js';
import { createSheetLock } from '../web/src/ui/sheetLock.js';
import { BP_PHONE, BP_TABLET, QUERY } from '../web/src/ui/breakpoints.js';

const src = nome => readFileSync(fileURLToPath(new URL('../web/src/' + nome, import.meta.url)), 'utf8');
const tokensCss = src('tokens.css');
const stylesCss = src('styles.css');
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

const tokensClaro = hexTokens(/:root \{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] || '');
const tokensEscuro = hexTokens(/:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] || '');
const stylesClaro = hexTokens(/:root \{([\s\S]*?)\n\}/.exec(stylesCss)?.[1] || '');
const stylesEscuro = hexTokens(/:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n\}/.exec(stylesCss)?.[1] || '');

test('tokens.css só declara tokens novos (não redefine o :root de styles.css)', () => {
  assert.equal(tokensClaro.bg, undefined);
  assert.equal(tokensEscuro.bg, undefined);
  assert.equal(tokensClaro.ink, undefined);
  assert.doesNotMatch(tokensCss, /--r-xl\s*:/);
  assert.doesNotMatch(tokensCss, /--raio-cartao\s*:/);
  assert.doesNotMatch(tokensCss, /--font\s*:/);
  assert.match(tokensCss, /--space-4:\s*16px/);
  assert.match(tokensCss, /--bp-phone:\s*640px/);
  assert.match(tokensCss, /--bp-tablet:\s*1100px/);
  assert.equal(tokensClaro.bubble, '#f2f2f2');
  assert.equal(tokensClaro.composer, '#ffffff');
  assert.equal(tokensEscuro.bubble, '#2c2c2c');
  assert.equal(tokensEscuro.composer, '#303030');
});

for (const [nome, dados] of [
  ['claro', { ...stylesClaro, ...tokensClaro }],
  ['escuro', { ...stylesClaro, ...stylesEscuro, ...tokensClaro, ...tokensEscuro }],
]) {
  test(`contraste dos tokens novos no tema ${nome} (≥ 4,5:1)`, () => {
    const fails = [];
    for (const fg of ['ink', 'ink-2', 'muted', 'faint']) {
      for (const bg of ['bubble', 'composer']) {
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
    assert.match(uiJsx, new RegExp(`export \\{[^}]*\\b${nome}\\b`));
  }
  assert.match(emptySrc, /export function EmptyState\(\{ title, body, action/);
  assert.match(skelSrc, /export function Skeleton\(\{ rows = 3, label = 'Carregando'/);
});

test('EmptyState antigo continua com as classes .empty', () => {
  assert.match(emptySrc, /className=\{className \? 'empty ' \+ className : 'empty'\}/);
  assert.match(emptySrc, /className="empty-title"/);
  assert.match(emptySrc, /className="empty-body"/);
});

test('ErrorState tem retry, detalhe recolhível e role=alert (sem aria-live redundante)', () => {
  const srcErro = src('ui/state/ErrorState.jsx');
  assert.match(srcErro, /Tentar de novo/);
  assert.match(srcErro, /<details/);
  assert.match(srcErro, /role="alert"/);
  assert.doesNotMatch(srcErro, /aria-live/);
});

test('Skeleton line usa div com role=status', () => {
  assert.match(skelSrc, /<div className="ui-skel-line"[^>]*role="status"/);
});

test('BottomSheet tem Esc, arrastar, foco preso, inert e onClose em ref', () => {
  const sheet = src('ui/BottomSheet.jsx');
  assert.match(sheet, /Escape/);
  assert.match(sheet, /trapTab/);
  assert.match(sheet, /onPointerDown/);
  assert.match(sheet, /onCloseRef/);
  assert.match(sheet, /\[open\]/);
  assert.match(sheet, /sheetLock/);
  assert.match(sheet, /100dvh|ui-sheet-root/);
  assert.match(sheet, /safe-area-inset-bottom|ui-sheet/);
  const css = src('styles/telas/ui-shell.css');
  assert.match(css, /100dvh/);
  assert.match(css, /z-index:\s*1600/);
  assert.match(css, /\.ui-sheet-handle-wrap\s*\{[^}]*touch-action:\s*none/);
  assert.doesNotMatch(css, /\.ui-sheet\s*\{[^}]*touch-action:\s*none/);
});

test('VirtualList usa key estável, altura medida, âncora e acessibilidade', () => {
  const list = src('ui/VirtualList.jsx');
  assert.match(list, /followEnd/);
  assert.match(list, /visibleRange/);
  assert.match(list, /item\.id/);
  assert.match(list, /ResizeObserver/);
  assert.match(list, /bindScroller/);
  assert.match(list, /scrollCompensation/);
  assert.match(list, /prependShift/);
  assert.match(list, /pruneMeasured/);
  assert.match(list, /aria-setsize/);
  assert.match(list, /aria-posinset/);
  assert.match(list, /offsetHeight/);
  assert.match(list, /followEnd \? 'log'/);
  assert.match(list, /pinnedIndices/);
  assert.match(list, /key=\{key\}/);
  assert.doesNotMatch(list, /aria-live/);
  assert.doesNotMatch(list, /ui-vlist-sticky/);
  assert.doesNotMatch(list, /if \(!items\.length\) return empty/);
  const css = src('styles/telas/ui-shell.css');
  assert.match(css, /\.ui-vlist-row\s*\{\s*display:\s*flow-root/);
  assert.match(css, /\.ui-vlist\s*\{[^}]*overflow-anchor:\s*none/);
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

test('visibleRange reusa prefixo incremental', () => {
  const items = [{ id: 0 }, { id: 1 }, { id: 2 }];
  const prefix = [0, 10, 20, 30];
  const r = visibleRange({
    items, getKey: x => x.id, measured: new Map(), estimate: 10,
    scrollTop: 0, viewport: 10, overscan: 0, prefix,
  });
  assert.equal(r.prefix, prefix);
  assert.equal(r.total, 30);
});

test('prefixHeights e lowerBound são consistentes', () => {
  const items = [{ id: 0 }, { id: 1 }, { id: 2 }];
  const prefix = prefixHeights(items, x => x.id, new Map(), 10);
  assert.deepEqual(prefix, [0, 10, 20, 30]);
  assert.equal(lowerBound(prefix, 0), 0);
  assert.equal(lowerBound(prefix, 10), 1);
  assert.equal(lowerBound(prefix, 29), 2);
});

test('patchPrefix incrementa a partir do índice sem mutar o original', () => {
  const p = [0, 10, 20, 30];
  assert.deepEqual(patchPrefix(p, 1, 5), [0, 10, 25, 35]);
  assert.deepEqual(p, [0, 10, 20, 30]);
  assert.equal(patchPrefix(p, 0, 0), p);
});

test('scrollCompensation só ajusta item acima da janela', () => {
  assert.equal(scrollCompensation(100, 200, 30), 30);
  assert.equal(scrollCompensation(199, 200, -10), -10);
  assert.equal(scrollCompensation(200, 200, 30), 0);
  assert.equal(scrollCompensation(250, 200, 30), 0);
  assert.equal(scrollCompensation(100, 200, 0), 0);
});

test('prependShift desloca pela altura das mensagens novas no topo', () => {
  const items = [{ id: 'old0' }, { id: 'a' }, { id: 'b' }];
  const measured = new Map([['old0', 80]]);
  assert.equal(prependShift('a', items, x => x.id, measured, 40), 80);
  assert.equal(prependShift('old0', items, x => x.id, measured, 40), 0);
  assert.equal(prependShift('missing', items, x => x.id, measured, 40), 0);
  assert.equal(prependShift(null, items, x => x.id, measured, 40), 0);
});

test('pruneMeasured remove chaves mortas do mapa', () => {
  const m = new Map([['a', 10], ['b', 20], ['c', 30]]);
  pruneMeasured(m, new Set(['a', 'c']));
  assert.deepEqual([...m.keys()], ['a', 'c']);
});

test('pinnedIndices mantém a linha focada na mesma lista', () => {
  assert.deepEqual(pinnedIndices(5, 10, -1), [5, 6, 7, 8, 9]);
  assert.deepEqual(pinnedIndices(5, 10, 7), [5, 6, 7, 8, 9]);
  assert.deepEqual(pinnedIndices(5, 10, 2), [2, 5, 6, 7, 8, 9]);
  assert.deepEqual(pinnedIndices(5, 10, 12), [5, 6, 7, 8, 9, 12]);
  assert.equal(pinnedIndices(5, 10, 2).filter(i => i === 2).length, 1);
});

test('sheetLock conta inert e overflow com duas folhas', () => {
  const body = { style: { overflow: '' } };
  const fundo = { inert: false };
  const lock = createSheetLock({ getBody: () => body, getFundo: () => fundo });
  const a = lock.acquire();
  assert.equal(lock.count, 1);
  assert.equal(body.style.overflow, 'hidden');
  assert.equal(fundo.inert, true);
  const b = lock.acquire();
  assert.equal(lock.count, 2);
  a();
  assert.equal(lock.count, 1);
  assert.equal(body.style.overflow, 'hidden');
  assert.equal(fundo.inert, true);
  a();
  assert.equal(lock.count, 1);
  b();
  assert.equal(lock.count, 0);
  assert.equal(body.style.overflow, '');
  assert.equal(fundo.inert, false);
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

test('exemplos cobrem os seis primitivos e role=log', () => {
  const ex = src('ui/examples.jsx');
  for (const nome of ['Skeleton', 'EmptyState', 'ErrorState', 'Card', 'BottomSheet', 'VirtualList']) {
    assert.match(ex, new RegExp(`<${nome}\\b`));
  }
  assert.match(ex, /10_000|10000/);
  assert.match(ex, /role="log"/);
});

test('primitivos carregam slots da ObsidianUI sem Tailwind nem Motion', () => {
  assert.match(src('ui/state/Skeleton.jsx'), /data-slot="skeleton"/);
  assert.match(src('ui/state/EmptyState.jsx'), /data-slot="empty"/);
  assert.match(src('ui/state/ErrorState.jsx'), /data-slot="alert"/);
  assert.match(src('ui/Card.jsx'), /data-slot="card"/);
  assert.match(src('ui/Card.jsx'), /export function CardHeader/);
  assert.match(src('ui/BottomSheet.jsx'), /data-slot="sheet"/);
  const pkg = readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8');
  assert.equal(/"tailwindcss"|"motion"|"gsap"|"vaul"|"@radix-ui\/react-dialog"/.test(pkg), false);
  assert.match(src('ui/obsidian/LICENSE'), /Copyright \(c\) 2026 ObsidianUI/);
  assert.match(src('ui/obsidian/README.md'), /Tailwind/);
});

test('primitivos não usados ficam de fora do bundle (reexport + CSS próprio)', () => {
  assert.match(uiJsx, /export \{ ErrorState \} from/);
  assert.match(uiJsx, /export \{ BottomSheet \} from/);
  assert.match(uiJsx, /export \{ VirtualList \} from/);
  assert.match(uiJsx, /export \{ Card/);
  assert.match(skelSrc, /import ['"]\.\.\/styles\.js['"]/);
  assert.match(emptySrc, /import ['"]\.\.\/styles\.js['"]/);
  assert.equal(/ui-shell/.test(skelSrc), false);
  assert.equal(/ui-shell/.test(emptySrc), false);
  assert.match(src('ui/Card.jsx'), /ui-shell/);
  assert.match(src('ui/BottomSheet.jsx'), /ui-shell/);
  assert.match(src('ui/VirtualList.jsx'), /ui-shell/);
  assert.match(src('ui/state/ErrorState.jsx'), /ui-shell/);

  const SRC = fileURLToPath(new URL('../web/src/', import.meta.url));
  const walk = (dir = SRC) => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(n) ? [p] : [];
  });
  const skip = /\/ui\/(examples|preview)\.jsx$|\/ui\.jsx$/;
  const hit = [];
  for (const p of walk()) {
    if (skip.test(p)) continue;
    const text = readFileSync(p, 'utf8');
    if (/\b(Card|BottomSheet|VirtualList|ErrorState)\b/.test(text) && /from ['"].*ui\.jsx['"]/.test(text)) {
      const names = [...text.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"][^'"]*ui\.jsx['"]/g)]
        .flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]));
      for (const n of ['Card', 'BottomSheet', 'VirtualList', 'ErrorState']) {
        if (names.includes(n)) hit.push(`${p.slice(SRC.length)}:${n}`);
      }
    }
  }
  assert.deepEqual(hit, []);
});
