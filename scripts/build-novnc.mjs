#!/usr/bin/env node
// Gera lib/novnc-static/rfb.bundle.js a partir de @novnc/novnc (MPL-2.0).
// `node scripts/build-novnc.mjs` escreve o arquivo; `--check` falha se divergir.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const entry = require.resolve('@novnc/novnc/lib/rfb.js');
const outfile = fileURLToPath(new URL('../lib/novnc-static/rfb.bundle.js', import.meta.url));
const check = process.argv.includes('--check');

const result = await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  globalName: 'NovncLib',
  platform: 'browser',
  target: ['es2018'],
  minify: true,
  legalComments: 'none',
  write: false,
  logLevel: 'silent'
});
const next = result.outputFiles[0].text.endsWith('\n') ? result.outputFiles[0].text : `${result.outputFiles[0].text}\n`;

if (check) {
  const prev = readFileSync(outfile, 'utf8');
  if (prev !== next) {
    console.error('lib/novnc-static/rfb.bundle.js está diferente do build de @novnc/novnc. Rode: npm run build:novnc');
    process.exit(1);
  }
  process.exit(0);
}

writeFileSync(outfile, next);
console.log(`escreveu ${outfile} (${Buffer.byteLength(next)} bytes)`);
