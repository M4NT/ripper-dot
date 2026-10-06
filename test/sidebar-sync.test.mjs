import test from 'node:test';
import assert from 'node:assert/strict';
import { patchSettings } from '../lib/settings-patch.mjs';

test('ordem da barra lateral fica nas configurações (igual em todos os aparelhos)', () => {
  const s = { ui: { mode: 'simple', locale: 'pt-BR' }, flags: {} };
  patchSettings(s, { ui: { sidebar: { pins: ['a', 'b', 'a'], order: ['c', 'g:1'] } } });
  assert.deepEqual(s.ui.sidebar, { pins: ['a', 'b'], order: ['c', 'g:1'] });
  assert.equal(s.ui.mode, 'simple', 'não mexe no resto da interface');
  patchSettings(s, { ui: { sidebar: { pins: ['b'] } } });
  assert.deepEqual(s.ui.sidebar.order, ['c', 'g:1'], 'mandar só os fixados mantém a ordem');
  assert.throws(() => patchSettings(s, { ui: { sidebar: { pins: ['1', '2', '3', '4', '5'] } } }), e => e.details?.some(d => d.path === 'ui.sidebar'));
});
