import './helpers/signed-in.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardOutbound } from '../lib/x9-guard.mjs';
import { freePort } from './helpers/free-port.mjs';

test('mascara segredos e dados sensíveis, sem devolver o valor', () => {
  const r = guardOutbound('Use a chave sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV e o token ghp_ABCDEFGHIJKLMNOPQRSTUVWX12. Senha: Omie@2026!', []);
  assert.ok(!r.text.includes('sk-ant-api03') && !r.text.includes('ghp_') && !r.text.includes('Omie@2026'));
  assert.match(r.text, /Senha: ••••/);
  assert.deepEqual(r.findings.sort(), ['chave de API', 'senha', 'token do GitHub']);
});

test('segredo salvo no Ripper (valor exato) e cartão válido; ignora números e links normais', () => {
  const r = guardOutbound('Login do portal: minha-senha-do-erp. Cartão 4111 1111 1111 1111.', ['minha-senha-do-erp']);
  assert.ok(!r.text.includes('minha-senha-do-erp'));
  assert.match(r.text, /•••• 1111/);
  assert.ok(r.findings.includes('número de cartão') && r.findings.includes('segredo salvo no Ripper'));
  const ok = 'Pedido 123456789012345 enviado. Rastreio https://loja.com/p/a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7 e CNPJ 12.345.678/0001-95.';
  assert.deepEqual(guardOutbound(ok).findings, [], 'pedido, link longo e CNPJ não são segredo');
  assert.equal(guardOutbound(ok).text, ok);
});

test('número longo que passa no Luhn mas não é de bandeira não é cartão', () => {
  assert.deepEqual(guardOutbound('Protocolo 8000000000000008 registrado.').findings, []);
});

test('de ponta a ponta: a resposta automática no WhatsApp sai com a senha mascarada e há aviso na Caixa', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { readFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const sent = [];
  const evo = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { if (req.url.startsWith('/message/sendText')) sent.push(JSON.parse(b)); res.end('{}'); }); });
  await new Promise(r => evo.listen(0, '127.0.0.1', r));
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-x9-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0', EVOLUTION_URL: `http://127.0.0.1:${evo.address().port}` }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const wait = async (fn, ms = 60_000) => { let v; for (let i = 0; i < ms / 200 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 200)); return v; };
  const put = b => fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const st = await (await fetch(base + '/api/state')).json();
    await put({ ui: { mode: 'enterprise' } });
    await put({ whatsappWeb: { enabled: true, agentId: st.agents[0].id, allowlist: ['5511988887777'] } });
    await fetch(base + '/api/channels/whatsapp-web/' + 'f'.repeat(48), { method: 'POST', body: '{}' });
    const { hookToken } = (await import('./helpers/evolution-secrets.mjs')).readEvolutionSecrets(dataDir);
    await fetch(base + '/api/channels/whatsapp-web/' + hookToken, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ripper-token': hookToken },
      body: JSON.stringify({ event: 'messages.upsert', data: { key: { id: 'x1', remoteJid: '5511988887777@s.whatsapp.net', fromMe: false }, pushName: 'Ana', message: { conversation: 'confirma minha senha: Segredo123 por favor' }, messageTimestamp: Math.floor(Date.now() / 1000) } }) });
    assert.ok(await wait(async () => sent.length > 0), 'a resposta deveria sair');
    assert.ok(!sent.some(m => String(m.text).includes('Segredo123')), 'a senha não pode sair');
    assert.match(sent[0].text, /senha: ••••/);
    const inbox = await (await fetch(base + '/api/inbox')).json();
    assert.ok(inbox.items.some(i => i.kind === 'system' && /X9 protegeu/.test(i.title)), 'aviso na Caixa');
    assert.ok(!JSON.stringify(inbox).includes('Segredo123'), 'o aviso não mostra o dado');
  } finally { child.kill(); evo.close(); }
});
