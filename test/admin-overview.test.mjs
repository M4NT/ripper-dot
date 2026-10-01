import test from 'node:test';
import assert from 'node:assert/strict';
import { isEnterpriseMode } from '../lib/enterprise.mjs';
import { buildAdminOverview } from '../lib/admin-overview.mjs';
import { applySettingsPatch } from '../lib/settings-patch.mjs';
import { buildLgpdStatus } from '../lib/lgpd-status.mjs';

test('isEnterpriseMode respeita ui.mode e enterprise.enabled', () => {
  assert.equal(isEnterpriseMode({ ui: { mode: 'simple' } }), false);
  assert.equal(isEnterpriseMode({ ui: { mode: 'enterprise' } }), true);
  assert.equal(isEnterpriseMode({ enterprise: { enabled: true } }), true);
});

test('applySettingsPatch alterna modo enterprise', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, ui: { mode: 'simple' }, enterprise: { enabled: false } };
  applySettingsPatch(s, { ui: { mode: 'enterprise' }, enterprise: { enabled: true } });
  assert.equal(s.ui.mode, 'enterprise');
  assert.equal(s.enterprise.enabled, true);
});

test('buildAdminOverview não inventa worm nem billing', () => {
  const db = { agents: [{ id: 'a1' }], auditLog: [], settings: { computer: { mode: 'docker' }, ui: { mode: 'enterprise' } } };
  const ov = buildAdminOverview(db, db.settings);
  assert.equal(ov.enterprise, true);
  assert.equal(ov.sections.auditTrail.worm, false);
  assert.equal(ov.sections.rbac.available, false);
  assert.ok(ov.sections.budget.notes.includes('fatura'));
  assert.equal(ov.sections.budget.spendUsd, undefined);
  assert.equal(ov.sections.budget.roiPercent, undefined);
});

test('buildLgpdStatus declara telemetria desligada', () => {
  const st = buildLgpdStatus({ settings: {} });
  assert.equal(st.productTelemetry, false);
  assert.equal(st.redactionInApi, true);
});
