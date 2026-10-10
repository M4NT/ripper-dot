import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  INITIAL_JS_GZIP_BUDGET, HOME_PATH_GZIP_BUDGET, CHAT_PATH_GZIP_BUDGET,
  initialModuleRefs, measureInitialJs, measureFiles, manifestClosure, findManifestKey
} from '../scripts/check-initial-bundle.mjs';
import { catchFx } from '../web/src/fx/loadFx.js';
import { micAvailable, micHint, stopTracks, MIC_CONSTRAINTS } from '../web/src/fx/mic.js';
import { botAvatarPalette } from '../web/src/fx/botAvatarPalette.js';
import { botAvatarPalette as pkgPalette } from 'bot-avatars';

const SRC = fileURLToPath(new URL('../web/src/', import.meta.url));
const HEAVY = /from ['"](thinking-orbs|metal-fx|liquid-gooey|voice-glow|border-beam|bot-avatars|three|@openuidev\/[^'"]+)['"]/;
const FX_DIR = join(SRC, 'fx');

const walk = (dir = SRC) => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /\.(jsx?)$/.test(n) ? [p] : [];
});

test('orçamentos gzip (inicial 300 KB, Home 300 KB, Chat 1 MB)', () => {
  assert.equal(INITIAL_JS_GZIP_BUDGET, 300 * 1024);
  assert.equal(HOME_PATH_GZIP_BUDGET, 300 * 1024);
  assert.equal(CHAT_PATH_GZIP_BUDGET, 1024 * 1024);
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

test('fecho do manifest soma só imports estáticos', () => {
  const manifest = {
    'index.html': { file: 'assets/index.js', imports: ['react.js'] },
    'react.js': { file: 'assets/react.js' },
    'src/app.jsx': { file: 'assets/app.js', imports: ['react.js'], dynamicImports: ['src/pages/Chat.jsx'] },
    'src/pages/Chat.jsx': { file: 'assets/Chat.js', imports: ['fx-openui.js'] },
    'fx-openui.js': { file: 'assets/fx-openui.js' }
  };
  assert.equal(findManifestKey(manifest, 'src/app.jsx'), 'src/app.jsx');
  const keys = manifestClosure(manifest, ['index.html', 'src/app.jsx']);
  assert.deepEqual([...keys].sort(), ['index.html', 'react.js', 'src/app.jsx']);
  assert.ok(!keys.includes('src/pages/Chat.jsx'));
  const skipped = manifestClosure(manifest, ['index.html', 'src/app.jsx', 'src/pages/Chat.jsx'], { skip: k => k === 'fx-openui.js' });
  assert.ok(!skipped.includes('fx-openui.js'));
  const dir = mkdtempSync(join(tmpdir(), 'ripper-mf-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index.js'), Buffer.alloc(10, 'i'));
  writeFileSync(join(dir, 'assets', 'react.js'), Buffer.alloc(10, 'r'));
  writeFileSync(join(dir, 'assets', 'app.js'), Buffer.alloc(10, 'a'));
  const { items } = measureFiles(dir, keys.map(k => manifest[k].file));
  assert.equal(items.length, 3);
});

test('nenhum arquivo fora de web/src/fx importa efeitos pesados', () => {
  const bad = walk().filter(p => !p.includes('/fx/') && !p.includes('/openui/'))
    .flatMap(p => {
      const hit = readFileSync(p, 'utf8').match(HEAVY);
      return hit ? [`${p.slice(SRC.length)}: ${hit[1]}`] : [];
    });
  assert.deepEqual(bad, []);
});

test('Chat e Home carregam sob demanda no casco', () => {
  const app = readFileSync(join(SRC, 'app.jsx'), 'utf8');
  assert.match(app, /const Chat = lazy\(\(\) => import\('\.\/pages\/Chat\.jsx'\)\)/);
  assert.match(app, /const Home = lazy\(\(\) => import\('\.\/pages\/Home\.jsx'\)\)/);
  assert.doesNotMatch(app, /import Chat from/);
  assert.doesNotMatch(app, /import Home from/);
});

test('App e Login usam lazyReload (mesmo recarregamento de chunk 404)', () => {
  const main = readFileSync(join(SRC, 'main.jsx'), 'utf8');
  assert.match(main, /lazyReload/);
  assert.match(main, /import\('\.\/app\.jsx'\)/);
  assert.match(main, /import\('\.\/login\.jsx'\)/);
  assert.match(readFileSync(join(SRC, 'lazyReload.js'), 'utf8'), /ripper\.reloaded/);
});

test('liquid-gooey tem .catch (sem unhandled rejection)', () => {
  assert.match(readFileSync(join(SRC, 'ui.jsx'), 'utf8'), /import\('liquid-gooey'\).*?\.catch\(/);
});

test('cada efeito em fx/ tem fallback de erro (catchFx, .catch ou FxBoundary)', () => {
  const files = readdirSync(FX_DIR).filter(n => /\.jsx$/.test(n) && n !== 'FxBoundary.jsx');
  assert.ok(files.length >= 5, 'faltam wrappers em fx/');
  for (const n of files) {
    const src = readFileSync(join(FX_DIR, n), 'utf8');
    const guarded = /catchFx|FxBoundary|\.catch\(/.test(src);
    assert.ok(guarded, `${n} sem fallback de erro`);
  }
});

test('catchFx devolve o fallback quando o import falha (404)', async () => {
  function Fallback() { return null; }
  const out = await catchFx(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), Fallback);
  assert.equal(out.default, Fallback);
  const ok = await catchFx(() => Promise.resolve({ default: 'real' }), Fallback);
  assert.equal(ok.default, 'real');
});

test('VoiceBeam não envolve o formulário em lazy/Suspense', () => {
  const src = readFileSync(join(FX_DIR, 'voiceGlow.jsx'), 'utf8');
  assert.doesNotMatch(src, /\blazy\s*\(/);
  assert.doesNotMatch(src, /<Suspense/);
  assert.match(src, /\{children\}/);
  assert.match(src, /fx-voice-layer/);
});

test('paleta local coincide com a do bot-avatars', () => {
  assert.deepEqual(botAvatarPalette, pkgPalette);
});

test('microfone: constraints, hint inseguro e stop sem vazar', () => {
  assert.equal(MIC_CONSTRAINTS.audio.echoCancellation, true);
  assert.equal(MIC_CONSTRAINTS.audio.noiseSuppression, true);
  assert.equal(MIC_CONSTRAINTS.audio.autoGainControl, true);
  assert.equal(micHint({ supported: false, secure: false }), 'O microfone precisa de HTTPS (ou localhost).');
  assert.equal(micHint({ supported: false, secure: true }), 'Este navegador não tem microfone.');
  assert.match(micHint({ supported: true, state: 'denied' }), /permissões/);
  assert.equal(micAvailable({}), false);
  assert.equal(micAvailable({ mediaDevices: { getUserMedia() {} } }), true);
  const stopped = [];
  stopTracks({ getTracks: () => [{ stop: () => stopped.push(1) }, { stop: () => stopped.push(2) }] });
  assert.deepEqual(stopped, [1, 2]);
  stopTracks(null);
});
