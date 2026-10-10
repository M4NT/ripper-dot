import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { INITIAL_JS_GZIP_BUDGET, initialModuleRefs, measureInitialJs } from '../scripts/check-initial-bundle.mjs';

const SRC = fileURLToPath(new URL('../web/src/', import.meta.url));
const HEAVY = /from ['"](thinking-orbs|metal-fx|liquid-gooey|voice-glow|border-beam|bot-avatars|three|@openuidev\/[^'"]+)['"]/;

test('orçamento do JS inicial é 300 KB gzip', () => {
  assert.equal(INITIAL_JS_GZIP_BUDGET, 300 * 1024);
});

test('lê só scripts module e modulepreload (ignora theme.js / sw-register.js)', () => {
  const html = `<!doctype html><html><head>
    <script src="/theme.js"></script>
    <script type="module" crossorigin src="/assets/index-aaa.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-bbb.js">
    <link href="/assets/fx-metal-ccc.js" rel="modulepreload">
    <link rel="stylesheet" href="/assets/index.css">
  </head><body><script src="/sw-register.js"></script></body></html>`;
  assert.deepEqual(initialModuleRefs(html), ['/assets/index-aaa.js', '/assets/react-bbb.js', '/assets/fx-metal-ccc.js']);
});

test('measureInitialJs soma gzip e falha acima do orçamento', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-bundle-'));
  mkdirSync(join(dir, 'assets'));
  const a = Buffer.alloc(1000, 'a');
  const b = Buffer.alloc(2000, 'b');
  writeFileSync(join(dir, 'assets', 'index.js'), a);
  writeFileSync(join(dir, 'assets', 'react.js'), b);
  writeFileSync(join(dir, 'index.html'), `<script type="module" src="/assets/index.js"></script><link rel="modulepreload" href="/assets/react.js">`);
  const { items, totalGzip } = measureInitialJs(dir);
  assert.equal(items.length, 2);
  assert.equal(totalGzip, gzipSync(a).length + gzipSync(b).length);
  assert.ok(totalGzip < INITIAL_JS_GZIP_BUDGET);
});

test('casco inicial não importa efeitos pesados nem OpenUI', () => {
  for (const file of ['main.jsx', 'app.jsx', 'ui.jsx']) {
    const src = readFileSync(join(SRC, file), 'utf8');
    const hit = src.match(HEAVY);
    assert.equal(hit, null, `${file} ainda importa ${hit?.[1]} no grafo estático`);
  }
});

test('Chat e Home carregam sob demanda no casco', () => {
  const app = readFileSync(join(SRC, 'app.jsx'), 'utf8');
  assert.match(app, /const Chat = lazy\(\(\) => import\('\.\/pages\/Chat\.jsx'\)\)/);
  assert.match(app, /const Home = lazy\(\(\) => import\('\.\/pages\/Home\.jsx'\)\)/);
  assert.doesNotMatch(app, /import Chat from/);
  assert.doesNotMatch(app, /import Home from/);
});
