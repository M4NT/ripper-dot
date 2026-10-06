import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealth, buildErrorReport, sanitizeForSupport } from '../lib/health.mjs';

test('buildHealth junta tudo numa lista com estado', () => {
  const now = Date.now();
  const h = buildHealth({
    uptimeSec: 600, docker: null,
    claudeAccounts: [{ label: 'Pessoal', loggedIn: true }, { label: 'Trabalho', loggedIn: false }],
    whatsapp: { enabled: false }, email: { enabled: true, ready: false },
    outboxCounts: { pending: 1, dead: 2 }, lastBackupAt: now - 3 * 86400_000, backupEnabled: true, now
  });
  const by = Object.fromEntries(h.items.map(i => [i.label, i.status]));
  assert.deepEqual(by, {
    Servidor: 'ok', Docker: 'error', 'Claude · Pessoal': 'ok', 'Claude · Trabalho': 'error',
    WhatsApp: 'off', 'E-mail': 'error', 'Fila de envios': 'error', 'Último backup': 'error'
  });
});

test('relatório de erro sai sem dados pessoais nem segredos', () => {
  const text = buildErrorReport({
    health: { items: [] },
    errors: [{ at: 0, text: 'falhou para joao@empresa.com.br cpf 529.982.247-25 tel (11) 98765-4321 key sk-ant-abc123XYZ em C:\\Users\\yan05\\x' }],
    alerts: [{ at: 0, title: 'E-mail', body: 'maria@x.com' }]
  });
  for (const leak of ['joao@', '529.982.247-25', '98765-4321', 'sk-ant-abc123XYZ', 'yan05', 'maria@']) assert.ok(!text.includes(leak), leak);
  assert.match(text, /Erros recentes/);
  assert.equal(sanitizeForSupport('/home/ana/app'), '/home/[user]/app');
});
