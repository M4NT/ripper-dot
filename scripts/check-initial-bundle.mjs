#!/usr/bin/env node
// Orçamento do JS: (1) scripts type=module + modulepreload do index.html;
// (2) fecho estático index+app+Home e index+app+Chat via manifest do Vite.
// Uso: npm run check:bundle (depois do vite build).
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INITIAL_JS_GZIP_BUDGET = 300 * 1024;
export const HOME_PATH_GZIP_BUDGET = 300 * 1024;
export const CHAT_PATH_GZIP_BUDGET = 1024 * 1024;

/** Efeitos carregados com import() — o Rolldown lista o chunk manual como import estático. */
const OPTIONAL_FX = /(?:^|\/|_)fx-(?:thinking-orbs|metal-fx|img-fx|liquid-gooey|voice-glow|border-beam|bot-avatars|three)/;
const OPENUI_FX = /(?:^|\/|_)fx-openui/;

export function isOptionalFx(key = '', chunk = {}) {
  const id = `${key} ${chunk.file || ''} ${chunk.name || ''}`;
  return OPTIONAL_FX.test(id);
}

export function initialModuleRefs(html) {
  const refs = [];
  const patterns = [
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/gi,
    /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/gi,
    /<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["']/gi,
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']modulepreload["']/gi
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) refs.push(m[1]);
  }
  return [...new Set(refs)].filter(r => /\.m?js(\?|$)/.test(r));
}

export function readManifest(distDir) {
  for (const rel of ['.vite/manifest.json', 'manifest.json']) {
    const p = join(distDir, rel);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  return null;
}

export function findManifestKey(manifest, suffix) {
  const want = suffix.replace(/\\/g, '/');
  return Object.keys(manifest).find(k => k.replace(/\\/g, '/').endsWith(want));
}

/** Fecho estático (imports, sem dynamicImports) a partir das chaves do manifest. */
export function manifestClosure(manifest, keys, { skip } = {}) {
  const seen = new Set();
  const queue = keys.filter(Boolean);
  while (queue.length) {
    const k = queue.pop();
    if (!k || seen.has(k) || !manifest[k]) continue;
    if (skip?.(k, manifest[k])) continue;
    seen.add(k);
    for (const i of manifest[k].imports || []) queue.push(i);
  }
  return [...seen];
}

export function measureFiles(distDir, relFiles) {
  const items = [...new Set(relFiles)].filter(f => /\.m?js(\?|$)/.test(f)).map(ref => {
    const file = join(distDir, ref.replace(/^\//, '').split('?')[0]);
    const buf = readFileSync(file);
    return { ref: ref.startsWith('/') ? ref : '/' + ref, raw: buf.length, gzip: gzipSync(buf).length };
  });
  return {
    items,
    totalRaw: items.reduce((s, i) => s + i.raw, 0),
    totalGzip: items.reduce((s, i) => s + i.gzip, 0)
  };
}

export function measureInitialJs(distDir) {
  const htmlPath = join(distDir, 'index.html');
  if (!existsSync(htmlPath)) throw new Error(`index.html não encontrado em ${distDir}. Rode npm run build.`);
  return measureFiles(distDir, initialModuleRefs(readFileSync(htmlPath, 'utf8')));
}

export function measureRoutePath(distDir, suffixes, { includeOpenUi = false } = {}) {
  const manifest = readManifest(distDir);
  if (!manifest) throw new Error(`manifest.json não encontrado em ${distDir}. Rode npm run build.`);
  const keys = suffixes.map(s => findManifestKey(manifest, s));
  const missing = suffixes.filter((s, i) => !keys[i]);
  if (missing.length) throw new Error(`chaves do manifest ausentes: ${missing.join(', ')}`);
  const skip = (k, chunk) => isOptionalFx(k, chunk) || (!includeOpenUi && OPENUI_FX.test(`${k} ${chunk.file || ''} ${chunk.name || ''}`));
  const files = manifestClosure(manifest, keys, { skip }).map(k => manifest[k].file).filter(Boolean);
  return measureFiles(distDir, files);
}

const kb = n => (n / 1024).toFixed(1);

function report(title, measured, budget) {
  console.log(title);
  for (const i of measured.items) console.log(`  ${kb(i.gzip).padStart(7)} KB gzip  ${i.ref}`);
  console.log(`  ${kb(measured.totalGzip)} KB gzip no total (limite ${kb(budget)} KB)`);
  if (measured.totalGzip > budget) {
    console.error(`  acima do orçamento: ${kb(measured.totalGzip)} KB gzip > ${kb(budget)} KB`);
    return false;
  }
  return true;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && self === process.argv[1]) {
  const dist = join(dirname(self), '..', 'dist');
  let ok = report('JS inicial (index.html)', measureInitialJs(dist), INITIAL_JS_GZIP_BUDGET);
  ok = report('caminho app+Home', measureRoutePath(dist, ['index.html', 'src/app.jsx', 'src/pages/Home.jsx']), HOME_PATH_GZIP_BUDGET) && ok;
  ok = report('caminho app+Chat', measureRoutePath(dist, ['index.html', 'src/app.jsx', 'src/pages/Chat.jsx'], { includeOpenUi: true }), CHAT_PATH_GZIP_BUDGET) && ok;
  if (!ok) process.exit(1);
}
