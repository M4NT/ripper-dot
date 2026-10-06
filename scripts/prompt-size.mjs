#!/usr/bin/env node
/**
 * Tamanho do prompt de sistema fixo por agente e por seção (caracteres e tokens estimados, ~4 chars/token).
 * Lê RIPPER_DATA/db.json (ou ./data/db.json) só para leitura; sem dados, usa agentes de exemplo.
 * Uso: node scripts/prompt-size.mjs [--json]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { systemPromptSections } from '../lib/providers.mjs';
import { newAgent, TOOLS } from '../lib/store.mjs';

const file = resolve(process.env.RIPPER_DATA || 'data', 'db.json');
let db;
try { db = JSON.parse(readFileSync(file, 'utf8')); } catch {
  db = {
    settings: { computer: { mode: 'docker' } },
    agents: [newAgent({ name: 'Padrão' }), newAgent({ name: 'Completo', description: 'Faz tudo.', tools: TOOLS }), newAgent({ name: 'Só conversa', tools: [] })]
  };
  console.error(`(${file} não encontrado: usando agentes de exemplo)`);
}
const settings = { computer: { mode: 'off' }, ...db.settings };
const tok = n => Math.ceil(n / 4);

const rows = db.agents.map(a => {
  const sections = systemPromptSections(a, settings).map(([name, text]) => ({ name, chars: text.length, tokens: tok(text.length) }));
  const chars = sections.reduce((n, s) => n + s.chars, 0) + 2 * Math.max(0, sections.length - 1);
  return { agent: a.name, tools: a.tools, chars, tokens: tok(chars), sections };
});

if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else {
  for (const r of rows) {
    console.log(`\n${r.agent} [${r.tools.join(', ') || 'sem ferramentas'}] — ${r.chars} chars, ~${r.tokens} tokens`);
    for (const s of r.sections) console.log(`  ${s.name.padEnd(24)} ${String(s.chars).padStart(6)}  ~${s.tokens}`);
  }
  const total = rows.reduce((n, r) => n + r.chars, 0);
  console.log(`\nMédia: ${Math.round(total / (rows.length || 1))} chars (~${tok(total / (rows.length || 1))} tokens) em ${rows.length} agentes.`);
}
