import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('ações externas: grava sempre, filtra por tipo/agente e exporta CSV', async () => {
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = mkdtempSync(join(tmpdir(), 'ripper-ext-'));
  const { _resetStoreForTests } = await import('../lib/store.mjs');
  const { _resetAuditTrailForTests } = await import('../lib/audit-trail.mjs');
  _resetStoreForTests(); _resetAuditTrailForTests();
  try {
    const { recordExternal, listExternal, externalCsv } = await import('../lib/external-actions.mjs');
    recordExternal({ kind: 'whatsapp.sent', agentId: 'a', target: '+5516999990000', text: 'Oi; tudo "certo"?\nAté', approved: 'user' });
    recordExternal({ kind: 'social.posted', agentId: 'b', target: 'Blog', text: 'x'.repeat(500), approved: 'rule', ok: false, error: 'HTTP 500' });
    const all = listExternal();
    assert.equal(all.length, 2);
    assert.equal(listExternal({ kind: 'whatsapp.sent' })[0].target, '+5516999990000');
    assert.equal(listExternal({ agentId: 'b' })[0].ok, false);
    assert.ok(listExternal({ agentId: 'b' })[0].preview.length <= 161, 'guarda só um trecho');
    const csv = externalCsv(all, id => ({ a: 'Ana', b: 'Bia' })[id]);
    assert.match(csv, /WhatsApp enviado;Ana;\+5516999990000;"Oi; tudo ""certo""\?\nAté";você;ok/);
    assert.match(csv, /falhou: HTTP 500/);
  } finally {
    _resetAuditTrailForTests(); _resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  }
});
