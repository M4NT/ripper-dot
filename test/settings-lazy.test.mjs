import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const settings = readFileSync(join(root, 'web/src/pages/Settings.jsx'), 'utf8');
const adminUso = readFileSync(join(root, 'web/src/pages/AdminUso.jsx'), 'utf8');
const adminCenter = readFileSync(join(root, 'web/src/pages/AdminCenter.jsx'), 'utf8');

const TABS = ['profile', 'models', 'computer', 'channels', 'plugins', 'security', 'backup', 'memory', 'appearance', 'advanced'];

test('Settings.jsx é um casco leve com seções sob demanda', () => {
  const bytes = statSync(join(root, 'web/src/pages/Settings.jsx')).size;
  assert.ok(bytes < 8_000, `Settings.jsx ficou grande demais (${bytes} bytes); seções devem viver em web/src/settings/`);
  assert.match(settings, /lazy\(/);
  assert.match(settings, /Suspense/);
  for (const tab of TABS) {
    const file = tab[0].toUpperCase() + tab.slice(1) + 'Section.jsx';
    assert.match(settings, new RegExp(`import\\(['"]\\.\\./settings/${file}['"]\\)`));
    assert.ok(statSync(join(root, 'web/src/settings', file)).size > 200, `seção ${file} vazia`);
  }
  assert.doesNotMatch(settings, /from ['"]metal-fx['"]/);
  assert.doesNotMatch(settings, /WhatsappWebPanel/);
  assert.doesNotMatch(settings, /providersCatalog/);
  assert.doesNotMatch(settings, /ApprovalHistory/);
});

test('painéis administrativos pouco usados carregam sob demanda', () => {
  assert.match(adminUso, /lazy\(\(\) => import\('\.\.\/admin\/UsageReportPanel\.jsx'\)\)/);
  assert.match(adminUso, /lazy\(\(\) => import\('\.\.\/admin\/MeteringPanel\.jsx'\)\)/);
  assert.match(adminUso, /lazy\(\(\) => import\('\.\.\/admin\/JuliaEconomiaPanel\.jsx'\)\)/);
  assert.match(adminUso, /lazy\(\(\) => import\('\.\.\/admin\/TokenBudgetPanel\.jsx'\)\)/);
  assert.match(adminUso, /lazy\(\(\) => import\('\.\.\/admin\/ClientsPanel\.jsx'\)\)/);
  assert.match(adminCenter, /lazy\(\(\) => import\('\.\.\/x9Auditor\.jsx'\)\)/);
});
