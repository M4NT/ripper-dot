#!/usr/bin/env node
/**
 * Ferramentas opt-in para inspecionar e limpar dados locais (RIPPER_DATA).
 * Uso: node scripts/ripper-data.mjs <info|clear-usage|clear-julia> [--confirm]
 */
import {
  summarizeLocalData,
  clearUsageEventsStore,
  clearJuliaEventsStore
} from '../lib/data-retention.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const confirm = rest.includes('--confirm');

function usage() {
  console.error(`Uso:
  node scripts/ripper-data.mjs info
  node scripts/ripper-data.mjs clear-usage --confirm
  node scripts/ripper-data.mjs clear-julia --confirm`);
  process.exit(cmd ? 1 : 0);
}

if (!cmd) usage();

if (cmd === 'info') {
  console.log(JSON.stringify(summarizeLocalData(), null, 2));
  process.exit(0);
}

if (cmd === 'clear-usage') {
  if (!confirm) {
    console.error('Recusado: passe --confirm para apagar eventos em usage.sqlite.');
    process.exit(1);
  }
  console.log(JSON.stringify(clearUsageEventsStore(), null, 2));
  process.exit(0);
}

if (cmd === 'clear-julia') {
  if (!confirm) {
    console.error('Recusado: passe --confirm para apagar eventos em julia.sqlite.');
    process.exit(1);
  }
  console.log(JSON.stringify(clearJuliaEventsStore(), null, 2));
  process.exit(0);
}

usage();
