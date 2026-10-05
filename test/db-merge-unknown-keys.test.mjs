import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePersistedDb } from '../lib/db-merge.mjs';

const defaults = { schemaVersion: 2, settings: {}, auditLog: [], agents: [] };

test('chaves sem regra própria sobrevivem à gravação (correções do Auto, auditoria)', () => {
  const local = { settings: {}, agents: [], auditLog: [{ at: 1, action: 'x' }], juliaCorrections: [{ ask: 'oi', to: 'claude-opus-5-5' }] };
  const out = mergePersistedDb(defaults, {}, local, null, {});
  assert.deepEqual(out.juliaCorrections, local.juliaCorrections);
  assert.deepEqual(out.auditLog, local.auditLog);
});

test('chave que só existe no disco (outro processo) é mantida', () => {
  const out = mergePersistedDb(defaults, { juliaCorrections: [{ ask: 'a' }] }, { settings: {}, agents: [] }, null, {});
  assert.deepEqual(out.juliaCorrections, [{ ask: 'a' }]);
});
