#!/usr/bin/env node
// Orçamento do JS inicial: scripts type=module + modulepreload do index.html.
// Falha se a soma gzip passar de 300 KB. Uso: npm run check:bundle (depois do vite build).
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INITIAL_JS_GZIP_BUDGET = 300 * 1024;

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

export function measureInitialJs(distDir) {
  const htmlPath = join(distDir, 'index.html');
  if (!existsSync(htmlPath)) throw new Error(`index.html não encontrado em ${distDir}. Rode npm run build.`);
  const html = readFileSync(htmlPath, 'utf8');
  const items = initialModuleRefs(html).map(ref => {
    const file = join(distDir, ref.replace(/^\//, '').split('?')[0]);
    const buf = readFileSync(file);
    return { ref, raw: buf.length, gzip: gzipSync(buf).length };
  });
  return {
    items,
    totalRaw: items.reduce((s, i) => s + i.raw, 0),
    totalGzip: items.reduce((s, i) => s + i.gzip, 0)
  };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && self === process.argv[1]) {
  const dist = join(dirname(self), '..', 'dist');
  const { items, totalGzip } = measureInitialJs(dist);
  const kb = n => (n / 1024).toFixed(1);
  for (const i of items) console.log(`${kb(i.gzip).padStart(7)} KB gzip  ${i.ref}`);
  console.log(`${kb(totalGzip)} KB gzip no total (limite ${kb(INITIAL_JS_GZIP_BUDGET)} KB)`);
  if (totalGzip > INITIAL_JS_GZIP_BUDGET) {
    console.error(`JS inicial acima do orçamento: ${kb(totalGzip)} KB gzip > ${kb(INITIAL_JS_GZIP_BUDGET)} KB`);
    process.exit(1);
  }
}
