import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportAllEntries, writeEntries, removeDir, chatToMarkdown } from '../lib/export-all.mjs';

test('exportar tudo: Markdown, agentes, rotinas sem segredo, arquivos e artefatos', async () => {
  const src = mkdtempSync(join(tmpdir(), 'exp-src-'));
  writeFileSync(join(src, 'a.txt'), 'oi');
  const db = {
    agents: [{ id: 'a1', name: 'Ana', instructions: 'Seja breve.' }],
    chats: [{ title: 'Plano/X', agentId: 'a1', messages: [{ role: 'user', content: 'olá' }, { role: 'assistant', content: 'oi' }, { role: 'system', content: 'oculto' }] }, { title: 'Plano/X', messages: [] }],
    routines: [{ id: 'r1', name: 'diária', hookSecret: 'SEGREDO123' }],
    files: [{ name: 'a.txt', path: 'a.txt' }, { name: 'sumiu.txt', path: 'nao-existe' }],
    artifacts: [{ id: 'x', title: 'Relatório', kind: 'doc' }]
  };
  const entries = await exportAllEntries(db, { dataPath: rel => join(src, rel), readArtifact: async () => '# rel' });
  const paths = entries.map(e => e.path);
  assert.ok(paths.includes('conversas/Plano_X.md') && paths.includes('conversas/1-Plano_X.md'));
  assert.ok(paths.includes('agentes/Ana.json') && paths.includes('agentes/Ana.instrucoes.md'));
  assert.ok(paths.includes('arquivos/a.txt') && !paths.some(p => p.includes('sumiu')));
  assert.ok(paths.includes('artefatos/Relatório.md'));
  assert.ok(!entries.find(e => e.path === 'rotinas.json').text.includes('SEGREDO123'));
  const md = chatToMarkdown(db.chats[0], { a1: db.agents[0] });
  assert.match(md, /## Você/); assert.match(md, /## Ana/); assert.doesNotMatch(md, /oculto/);
  const dir = writeEntries(entries);
  assert.equal(readFileSync(join(dir, 'arquivos/a.txt'), 'utf8'), 'oi');
  removeDir(dir); removeDir(src);
});
