import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettingsPatch } from '../lib/settings-schema.mjs';
import { buildCodexSpawnArgs } from '../lib/providers.mjs';
import { CONNECTORS } from '../web/src/marketplace/catalog.js';
import { installPlugin } from '../web/src/marketplace/state.js';

test('GA4 e Search Console rodam localmente em versão fixa', () => {
  const ga = CONNECTORS.find(c => c.id === 'google-analytics'), gsc = CONNECTORS.find(c => c.id === 'search-console');
  assert.deepEqual(ga.mcp, { name: 'google-analytics', type: 'stdio', command: 'pipx', args: ['run', 'analytics-mcp==0.7.0'] });
  assert.deepEqual(gsc.mcp.args, ['-y', 'mcp-server-gsc@0.3.0']);
  assert.deepEqual(ga.connect.fields.map(f => f.key), ['GOOGLE_PROJECT_ID']);
  assert.deepEqual(gsc.connect.fields.map(f => f.key), ['GOOGLE_APPLICATION_CREDENTIALS']);
});

test('variáveis do conector: aceitas em MAIÚSCULAS com texto; o resto é recusado', () => {
  const plugins = installPlugin('google-analytics', { plugins: [] }, { env: { GOOGLE_PROJECT_ID: 'meu-projeto' } });
  const ok = validateSettingsPatch({ plugins });
  assert.deepEqual(ok.filter(d => /env/.test(d.path)), []);
  for (const env of [{ 'nome-ruim': 'x' }, { OK: 1 }, ['A']]) {
    const r = JSON.stringify(validateSettingsPatch({ plugins: [{ ...plugins[0], env }] }));
    assert.match(r, /plugins\[0\]\.env/);
  }
});

test('o Codex recebe as variáveis do conector local', () => {
  const agent = { tools: ['plugins'] };
  const settings = { computer: { mode: 'off' }, plugins: [{ name: 'google-analytics', type: 'stdio', command: 'pipx', args: ['run', 'analytics-mcp==0.7.0'], env: { GOOGLE_PROJECT_ID: 'meu-projeto' } }] };
  const args = buildCodexSpawnArgs({ agent, settings, effort: 'auto' }).join(' ');
  assert.match(args, /mcp_servers\.google-analytics\.env\.GOOGLE_PROJECT_ID="meu-projeto"/);
});
