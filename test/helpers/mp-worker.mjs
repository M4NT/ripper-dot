/**
 * Worker para testes multi-processo (spawn via child_process).
 * Variáveis: RIPPER_DATA (obrigatório), RIPPER_MP_CMD.
 */
import assert from 'node:assert/strict';

const cmd = process.env.RIPPER_MP_CMD;
const dataDir = process.env.RIPPER_DATA;
assert.ok(dataDir, 'RIPPER_DATA obrigatório');
assert.ok(cmd, 'RIPPER_MP_CMD obrigatório');

const { _resetStoreForTests, load, save, flush, id, newAgent } = await import('../../lib/store.mjs');

_resetStoreForTests();

if (cmd === 'load') {
  load();
  process.stdout.write('ok');
  process.exit(0);
}

if (cmd === 'usage-burst') {
  const n = +(process.env.RIPPER_MP_N || 50);
  const { recordUsage } = await import('../../lib/usage.mjs');
  const db = load();
  for (let i = 0; i < n; i++) recordUsage(db, 'codex', { charsIn: 1, charsOut: 0 });
  flush();
  process.stdout.write(String(n));
  process.exit(0);
}

if (cmd === 'agent-patch') {
  const suffix = process.env.RIPPER_MP_SUFFIX || 'A';
  const db = load();
  const agent = db.agents[0];
  agent.name = `Agente-${suffix}`;
  agent.updatedAt = Date.now();
  save();
  flush();
  process.stdout.write(agent.name);
  process.exit(0);
}

if (cmd === 'settings-patch') {
  const tag = process.env.RIPPER_MP_TAG || 'x';
  const db = load();
  db.settings.name = `Nome-${tag}`;
  save();
  flush();
  process.stdout.write(db.settings.name);
  process.exit(0);
}

console.error('comando desconhecido:', cmd);
process.exit(2);
