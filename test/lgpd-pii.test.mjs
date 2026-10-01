import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isValidCpf,
  redactBrazilianPii,
  lgpdMiddlewareProviderPayload,
  lgpdMiddlewareText,
  executeLgpdErasure,
  normalizeLgpdSettings
} from '../lib/lgpd-pii.mjs';

/** CPF válido de exemplo (Gerador Receita — uso só em teste). */
const SAMPLE_CPF = '529.982.247-25';
const SAMPLE_CPF_DIGITS = '52998224725';

test('isValidCpf rejeita sequência repetida', () => {
  assert.equal(isValidCpf('11111111111'), false);
  assert.equal(isValidCpf(SAMPLE_CPF_DIGITS), true);
});

test('redactBrazilianPii mascara CPF formatado e contínuo', () => {
  const a = redactBrazilianPii(`Titular ${SAMPLE_CPF} e ${SAMPLE_CPF_DIGITS}`);
  assert.match(a.text, /Titular \[PII\] e \[PII\]/);
  assert.equal(a.hits, 2);
  assert.equal(a.byKind.cpf, 2);
});

test('redactBrazilianPii mascara agência e conta', () => {
  const r = redactBrazilianPii('Pague na agência 1234 conta 56789-0');
  assert.match(r.text, /Pague na \[PII\]/);
  assert.ok(r.byKind.financial >= 1);
});

test('redactBrazilianPii respeita opt-out de categoria', () => {
  const r = redactBrazilianPii(SAMPLE_CPF, { categories: { cpf: false, documents: true, financial: true, contact: true } });
  assert.match(r.text, /529/);
  assert.equal(r.hits, 0);
});

test('lgpdMiddlewareText só age com enabled', () => {
  const off = { lgpd: normalizeLgpdSettings({ enabled: false }) };
  const on = { lgpd: normalizeLgpdSettings({ enabled: true }) };
  assert.equal(lgpdMiddlewareText(SAMPLE_CPF, off), SAMPLE_CPF);
  assert.equal(lgpdMiddlewareText(SAMPLE_CPF, on), '[PII]');
});

test('lgpdMiddlewareProviderPayload redact histórico e system', () => {
  const settings = { lgpd: { enabled: true, redactBeforeLlm: true } };
  const out = lgpdMiddlewareProviderPayload({
    prompt: `meu cpf ${SAMPLE_CPF}`,
    history: [{ role: 'user', content: `outro ${SAMPLE_CPF_DIGITS}` }],
    system: `RG 12.345.678-9`
  }, settings);
  assert.match(out.prompt, /\[PII\]/);
  assert.match(out.history[0].content, /\[PII\]/);
  assert.match(out.system, /\[PII\]/);
});

async function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-lgpd-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  const { _resetStoreForTests, load, save, id } = await import('../lib/store.mjs');
  try {
    const db = load();
    fn(db, { save, id, dir });
  } finally {
    _resetStoreForTests();
    process.env.RIPPER_DATA = prev;
  }
}

test('executeLgpdErasure apaga chats e perfil', async () =>
  withDb(async db => {
    db.settings.name = 'Maria';
    db.settings.customInstructions = 'Sou de SP';
    db.chats.push({
      id: 'c1',
      agentId: 'a',
      title: 't',
      messages: [{ id: 'm1', role: 'user', content: SAMPLE_CPF, at: Date.now() }],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    db.memories.push({ id: 'mem', agentId: 'a', text: 'segredo', tier: 'profile', createdAt: Date.now() });
    const report = await executeLgpdErasure(db, { scope: 'all', audit: false });
    assert.equal(report.chatsRemoved, 1);
    assert.equal(report.memoriesRemoved, 1);
    assert.equal(db.chats.length, 0);
    assert.equal(db.settings.name, '');
    assert.equal(db.settings.customInstructions, '');
  }));

test('executeLgpdErasure scope profile mantém chats', async () =>
  withDb(async db => {
    db.settings.name = 'João';
    db.chats.push({ id: 'c1', agentId: 'a', title: 't', messages: [], createdAt: 1, updatedAt: 1 });
    const report = await executeLgpdErasure(db, { scope: 'profile', audit: false });
    assert.equal(report.profileCleared, true);
    assert.equal(db.chats.length, 1);
    assert.equal(db.settings.name, '');
  }));
