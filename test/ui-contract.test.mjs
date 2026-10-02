// Contrato estático da interface: pega, sem abrir navegador, os erros que já derrubaram telas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../web/src/', import.meta.url));
const files = (dir = SRC) => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.(jsx?|css)$/.test(n) ? [p] : [];
});
const all = files().map(p => ({ p: p.slice(SRC.length), src: readFileSync(p, 'utf8') }));
const jsx = all.filter(f => !f.p.endsWith('.css'));
const css = all.filter(f => f.p.endsWith('.css')).map(f => f.src).join('\n');

test('ThinkingOrb só recebe tamanhos que a biblioteca conhece (20, 32, 64)', () => {
  const bad = jsx.flatMap(f => [...f.src.matchAll(/<ThinkingOrb[^>]*\bsize=\{(\d+)\}/g)]
    .filter(m => ![20, 32, 64].includes(+m[1])).map(m => `${f.p}: size=${m[1]}`));
  assert.deepEqual(bad, [], 'tamanho inválido derruba a tela ("can\'t access property count")');
});

test('todo token var(--x) usado no CSS está definido', () => {
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const runtime = new Set(['--side-w', '--panel-w', '--brand-accent']); // definidos pelo JS (barras redimensionáveis, cor da marca)
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
  const missing = [...used].filter(t => !defined.has(t) && !runtime.has(t));
  assert.deepEqual(missing, [], 'token inexistente vira canto quadrado / cor errada em silêncio');
});

test('sem diálogos nativos do navegador (usar useOv().confirm / toast)', () => {
  const bad = jsx.filter(f => /window\.(confirm|alert|prompt)\(|(^|[^.\w])alert\(/m.test(f.src)).map(f => f.p);
  assert.deepEqual(bad, []);
});

test('sem notas internas de PR em texto visível', () => {
  const bad = jsx.flatMap(f => f.src.split('\n')
    .map((l, i) => [l, i + 1])
    .filter(([l]) => /draft #\d|\(#\d{2,}\)/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map(([, n]) => `${f.p}:${n}`));
  assert.deepEqual(bad, []);
});

test('nenhuma regex com a barra engolida (ex.: /D/g no lugar de /\D/g)', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const srcs = [join(root, 'server.mjs'), ...readdirSync(join(root, 'lib')).filter(n => n.endsWith('.mjs')).map(n => join(root, 'lib', n)), ...files().filter(p => !p.endsWith('.css'))];
  const bad = srcs.flatMap(p => [...readFileSync(p, 'utf8').matchAll(/\.replace\(\/[DWSdws]\/g/g)].map(() => p.slice(root.length)));
  assert.deepEqual(bad, [], 'replace(/D/g) apaga a letra D, não os não-dígitos');
});
