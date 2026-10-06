import './helpers/signed-in.mjs';
// WhatsApp por QR (Evolution): filtros, lista de números, limite e o webhook interno com token.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEvolutionMessage, isAllowed, makeRateLimiter, channelSafeAgent } from '../lib/evolution.mjs';

const msg = (key, text = 'oi', extra = {}) => ({ event: 'messages.upsert', data: { key: { id: 'm1', ...key }, pushName: 'Ana', message: { conversation: text }, ...extra } });

test('ignora grupo, status, mensagens nossas e mídia; resolve número de JID @lid', () => {
  assert.deepEqual(parseEvolutionMessage(msg({ remoteJid: '5511988887777@s.whatsapp.net' })), { id: 'm1', from: '5511988887777', name: 'Ana', text: 'oi' });
  assert.equal(parseEvolutionMessage(msg({ remoteJid: '1203@g.us' })), null);
  assert.equal(parseEvolutionMessage(msg({ remoteJid: 'status@broadcast' })), null);
  assert.equal(parseEvolutionMessage(msg({ remoteJid: '5511988887777@s.whatsapp.net', fromMe: true })), null); // evita loop
  assert.equal(parseEvolutionMessage({ event: 'messages.upsert', data: { key: { remoteJid: '55119@s.whatsapp.net' }, message: { imageMessage: {} } } }), null);
  assert.equal(parseEvolutionMessage(msg({ remoteJid: '123@lid', senderPn: '5511988887777@s.whatsapp.net' })).from, '5511988887777');
  assert.equal(parseEvolutionMessage({ event: 'connection.update', data: {} }), null);
});

test('lista de números aceita formatos e o 9 extra de celular BR', () => {
  const list = ['+55 (11) 98888-7777'];
  assert.equal(isAllowed('5511988887777', list), true);
  assert.equal(isAllowed('551188887777', list), true); // sem o 9
  assert.equal(isAllowed('5511977776666', list), false);
  assert.equal(isAllowed('5511988887777', []), false); // lista vazia = ninguém
});

test('limite por contato e geral; canal externo sem computador/navegador/plugins', () => {
  const ok = makeRateLimiter({ perContact: 2, global: 3 });
  assert.deepEqual([ok('a'), ok('a'), ok('a'), ok('b'), ok('c')], [true, true, false, true, false]);
  assert.deepEqual(channelSafeAgent({ tools: ['web', 'computer', 'browser', 'memory', 'plugins', 'routines'] }).tools, ['web', 'memory']);
});

test('webhook interno: recusa sem token, guarda só quem está na lista e responde pela Evolution', async () => {
  const sent = [];
  const evo = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => { sent.push({ url: req.url, apikey: req.headers.apikey, body: JSON.parse(b || '{}') }); res.setHeader('content-type', 'application/json'); res.end('{}'); });
  });
  await new Promise(r => evo.listen(0, '127.0.0.1', r));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-waweb-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0', EVOLUTION_URL: `http://127.0.0.1:${evo.address().port}` },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
    const st = await (await fetch(base + '/api/state')).json();
    const put = b => fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
    assert.equal((await put({ ui: { mode: 'enterprise' } })).status, 200);
    assert.equal((await put({ whatsappWeb: { enabled: true, agentId: st.agents[0].id, allowlist: ['+55 11 98888-7777', 'abc'] } })).status, 200);
    const saved = (await (await fetch(base + '/api/state')).json()).settings.whatsappWeb;
    assert.deepEqual(saved.allowlist, ['5511988887777']); // normalizou e descartou lixo

    // o primeiro acesso aos segredos cria data/evolution.json; o token não aparece em lugar nenhum da API
    await fetch(base + '/api/channels/whatsapp-web/' + 'f'.repeat(48), { method: 'POST', body: '{}' });
    const { hookToken, apiKey } = (await import('./helpers/evolution-secrets.mjs')).readEvolutionSecrets(dataDir);
    const stateTxt = await (await fetch(base + '/api/state')).text();
    assert.ok(!stateTxt.includes(hookToken) && !stateTxt.includes(apiKey));

    const hook = base + '/api/channels/whatsapp-web/' + hookToken;
    const send = (ev, token = hookToken) => fetch(hook, { method: 'POST', body: JSON.stringify(ev), headers: { 'content-type': 'application/json', 'x-ripper-token': token } });
    assert.equal((await send(msg({ remoteJid: '5511988887777@s.whatsapp.net' }), 'x'.repeat(48))).status, 401); // cabeçalho errado

    assert.equal((await send({ ...msg({ remoteJid: '5511977776666@s.whatsapp.net', id: 'fora' }) })).status, 200); // fora da lista
    assert.equal((await send(msg({ remoteJid: '5511988887777@s.whatsapp.net', id: 'dentro' }, 'qual o horário?'))).status, 200);
    for (let i = 0; i < 40 && !sent.some(s => s.url.startsWith('/message/sendText')); i++) await new Promise(r => setTimeout(r, 250));

    const out = sent.filter(s => s.url === '/message/sendText/ripper');
    assert.equal(out.length, 1);
    assert.equal(out[0].body.number, '5511988887777');
    assert.equal(out[0].apikey, apiKey);
    assert.ok(out[0].body.delay >= 1500); // atraso humano
    const chats = (await (await fetch(base + '/api/state')).json()).chats;
    assert.equal(chats.filter(c => c.title.startsWith('WhatsApp')).length, 0); // conversa do WhatsApp fica no WhatsApp
    const hist = (await (await fetch(base + '/api/whatsapp-web/status')).json()).history;
    assert.equal(hist.contacts, 1); // só o contato liberado entra no histórico (o de fora, não)

    // pausado: registra, não responde
    assert.equal((await put({ whatsappWeb: { paused: true } })).status, 200);
    await send(msg({ remoteJid: '5511988887777@s.whatsapp.net', id: 'pausado' }, 'tem alguém?'));
    await new Promise(r => setTimeout(r, 800));
    assert.equal(sent.filter(s => s.url === '/message/sendText/ripper').length, 1);
  } finally {
    child.kill(); evo.close();
  }
});

test('modo por contato: escolha no contato vence a lista; leitura ligada põe novo em rascunho', async () => {
  const { contactMode } = await import('../lib/evolution.mjs');
  const w = { allowlist: ['5511988887777'], contactModes: { '5511988887777': 'read', '5521977776666': 'auto' }, readAll: false };
  assert.equal(contactMode('5511988887777', w), 'read');
  assert.equal(contactMode('5521977776666', w), 'auto');
  assert.equal(contactMode('5531966665555', w), null);          // sem leitura: ignora
  assert.equal(contactMode('5531966665555', { ...w, readAll: true }), 'draft');
});

test('histórico: grava, lê, lista contatos, aprende estilo só com as suas mensagens e apaga', async () => {
  process.env.RIPPER_DATA = mkdtempSync(join(tmpdir(), 'ripper-wastore-'));
  const { _resetStoreForTests } = await import('../lib/store.mjs'); _resetStoreForTests();
  const st = await import('../lib/whatsapp-store.mjs'); st._resetWhatsappStoreForTests();
  const t0 = Date.now();
  st.recordMessage({ id: 'a', phone: '5511988887777', fromMe: false, text: 'Bom dia, o pedido chegou?', name: 'Ana', at: t0 });
  st.recordMessage({ id: 'a', phone: '5511988887777', fromMe: false, text: 'duplicada', at: t0 }); // mesmo id: ignora
  for (const [i, tx] of ['oi ana kkk', 'chegou sim', 'vc recebeu?', 'blz, valeu', 'tmj'].entries()) st.recordMessage({ id: 'm' + i, phone: '5511988887777', fromMe: true, text: tx, at: t0 + i + 1 });
  assert.equal(st.listChats()[0].name, 'Ana');
  const msgs = st.readChat('5511988887777');
  assert.equal(msgs.length, 6);
  assert.deepEqual([msgs[0].fromMe, msgs[0].text], [false, 'Bom dia, o pedido chegou?']);
  assert.equal(st.findContacts('ana')[0].phone, '5511988887777');
  const style = st.styleProfile();
  assert.equal(style.count, 5); // só as suas
  assert.ok(style.traits.includes('costuma começar em minúscula'));
  assert.ok(!style.examples.includes('Bom dia, o pedido chegou?'));
  st.wipeHistory();
  assert.equal(st.stats().messages, 0);
});

test('com leitura ligada: rascunho só sai com aprovação; "só lê" e mensagem sua nunca respondem', async () => {
  const sent = [];
  const evo = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { sent.push({ url: req.url, body: JSON.parse(b || '{}') }); res.end('{}'); }); });
  await new Promise(r => evo.listen(0, '127.0.0.1', r));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-waread-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0', EVOLUTION_URL: `http://127.0.0.1:${evo.address().port}` },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const wait = async (fn, ms = 10_000) => { for (let i = 0; i < ms / 200 && !(await fn()); i++) await new Promise(r => setTimeout(r, 200)); };
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const st = await (await fetch(base + '/api/state')).json();
    const put = b => fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
    await put({ ui: { mode: 'enterprise' } });
    await put({ whatsappWeb: { enabled: true, readAll: true, agentId: st.agents[0].id, allowlist: [], contactModes: { '5521977776666': 'read' } } });
    await fetch(base + '/api/channels/whatsapp-web/' + 'f'.repeat(48), { method: 'POST', body: '{}' }); // cria os segredos
    const { hookToken } = (await import('./helpers/evolution-secrets.mjs')).readEvolutionSecrets(dataDir);
    const send = ev => fetch(base + '/api/channels/whatsapp-web/' + hookToken, { method: 'POST', body: JSON.stringify(ev), headers: { 'content-type': 'application/json', 'x-ripper-token': hookToken } });

    await send(msg({ remoteJid: '5521977776666@s.whatsapp.net', id: 'so-le' }, 'oi, tudo bem?'));        // modo só lê
    await send(msg({ remoteJid: '5511988887777@s.whatsapp.net', id: 'meu', fromMe: true }, 'vou ver e te falo')); // mensagem sua
    await send(msg({ remoteJid: '5511988887777@s.whatsapp.net', id: 'novo' }, 'qual o prazo de entrega?'));  // contato novo: rascunho

    let pending;
    await wait(async () => (pending = (await (await fetch(base + '/api/approvals')).json()).pending.find(a => a.kind === 'whatsapp')));
    assert.ok(pending, 'rascunho deveria virar pedido de aprovação');
    assert.match(pending.command, /\+5511988887777/);
    assert.equal(sent.filter(s => s.url.startsWith('/message/sendText')).length, 0); // nada saiu antes do ok

    await fetch(base + `/api/approvals/${pending.id}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ approve: true }) });
    await wait(() => sent.some(s => s.url.startsWith('/message/sendText')));
    const out = sent.filter(s => s.url.startsWith('/message/sendText'));
    assert.equal(out.length, 1);
    assert.equal(out[0].body.number, '5511988887777');

    const status = await (await fetch(base + '/api/whatsapp-web/status')).json();
    assert.ok(status.history.messages >= 3); // só-lê + a sua + a do contato novo (+ a resposta)
    const contacts = (await (await fetch(base + '/api/whatsapp-web/contacts')).json()).contacts;
    assert.equal(contacts.find(c => c.phone === '5521977776666').mode, 'read');
  } finally {
    child.kill(); evo.close();
  }
});

test('grupo: parser lê quem falou; só guarda com "Ler grupos" e nunca responde', async () => {
  const { parseEvolutionGroup } = await import('../lib/evolution.mjs');
  const gEv = (id, text, extra = {}) => ({ event: 'messages.upsert', data: { key: { id, remoteJid: '120363111@g.us', participant: '5511988887777@s.whatsapp.net', ...extra }, pushName: 'Tia Ana', message: { conversation: text } } });
  assert.deepEqual(parseEvolutionGroup(gEv('g1', 'bom dia família')), { id: 'g1', groupJid: '120363111@g.us', key: 'g120363111', text: 'Tia Ana: bom dia família', fromMe: false, at: parseEvolutionGroup(gEv('g1', 'bom dia família')).at });
  assert.equal(parseEvolutionGroup(msg({ remoteJid: '5511988887777@s.whatsapp.net' })), null); // individual não é grupo
  assert.equal(parseEvolutionMessage(gEv('g1', 'oi')), null);                                    // grupo nunca entra no fluxo de resposta

  const sent = [];
  const evo = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { sent.push(req.url); res.setHeader('content-type', 'application/json'); res.end(req.url.startsWith('/group/') ? '{"subject":"Familia mil grau"}' : '{}'); }); });
  await new Promise(r => evo.listen(0, '127.0.0.1', r));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-wagrp-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0', EVOLUTION_URL: `http://127.0.0.1:${evo.address().port}` },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
    const st = await (await fetch(base + '/api/state')).json();
    const put = b => fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
    await put({ ui: { mode: 'enterprise' } });
    await put({ whatsappWeb: { enabled: true, readAll: true, readGroups: false, agentId: st.agents[0].id, allowlist: ['5511988887777'] } });
    await fetch(base + '/api/channels/whatsapp-web/' + 'f'.repeat(48), { method: 'POST', body: '{}' });
    const { hookToken } = (await import('./helpers/evolution-secrets.mjs')).readEvolutionSecrets(dataDir);
    const send = ev => fetch(base + '/api/channels/whatsapp-web/' + hookToken, { method: 'POST', body: JSON.stringify(ev), headers: { 'content-type': 'application/json', 'x-ripper-token': hookToken } });
    const hist = async () => (await (await fetch(base + '/api/whatsapp-web/status')).json()).history;

    await send(gEv('off', 'não deve guardar'));                       // "Ler grupos" desligado
    await new Promise(r => setTimeout(r, 400));
    assert.equal((await hist()).messages, 0);

    await put({ whatsappWeb: { readGroups: true } });
    await send(gEv('on', 'churrasco domingo?'));
    for (let i = 0; i < 20 && (await hist()).messages === 0; i++) await new Promise(r => setTimeout(r, 200));
    const contacts = (await (await fetch(base + '/api/whatsapp-web/contacts?q=familia')).json()).contacts;
    assert.equal(contacts[0]?.name, 'Familia mil grau');
    assert.equal(contacts[0]?.mode, 'group');
    await new Promise(r => setTimeout(r, 600));
    assert.equal(sent.filter(u => u.startsWith('/message/sendText')).length, 0); // nunca responde em grupo
  } finally { child.kill(); evo.close(); }
});

test('gatilho por evento: palavra-chave no WhatsApp dispara a rotina (mensagem sua não)', async () => {
  const evo = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
  await new Promise(r => evo.listen(0, '127.0.0.1', r));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-watrig-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0', EVOLUTION_URL: `http://127.0.0.1:${evo.address().port}` },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const wait = async (fn, ms = 10_000) => { for (let i = 0; i < ms / 200 && !(await fn()); i++) await new Promise(r => setTimeout(r, 200)); };
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });
    const st = await (await fetch(base + '/api/state')).json();
    const post = (path, b, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b) });
    await post('/api/settings', { ui: { mode: 'enterprise' } }, 'PUT');
    await post('/api/settings', { whatsappWeb: { enabled: true, agentId: st.agents[0].id, allowlist: [] } }, 'PUT');
    const r = await (await post('/api/routines', { agentId: st.agents[0].id, name: 'Urgências', prompt: 'Me avise.', trigger: 'whatsapp', keywords: 'urgente, orçamento', scope: 'contacts', quiet: false })).json();
    assert.deepEqual(r.keywords, ['urgente', 'orçamento']);
    await fetch(base + '/api/channels/whatsapp-web/' + 'f'.repeat(48), { method: 'POST', body: '{}' });
    const { hookToken } = (await import('./helpers/evolution-secrets.mjs')).readEvolutionSecrets(dataDir);
    const send = ev => fetch(base + '/api/channels/whatsapp-web/' + hookToken, { method: 'POST', body: JSON.stringify(ev), headers: { 'content-type': 'application/json', 'x-ripper-token': hookToken } });

    await send(msg({ remoteJid: '5511988887777@s.whatsapp.net', id: 'eu', fromMe: true }, 'isso é urgente'));
    await send(msg({ remoteJid: '5511988887777@s.whatsapp.net', id: 'nada' }, 'bom dia'));
    await new Promise(res => setTimeout(res, 600));
    assert.equal((await (await fetch(base + '/api/state')).json()).routines[0].lastRun, 0, 'mensagem sua ou sem palavra-chave não dispara');

    await send(msg({ remoteJid: '5511988887777@s.whatsapp.net', id: 'sim' }, 'Preciso de um ORCAMENTO hoje'));
    let chat;
    await wait(async () => (chat = (await (await fetch(base + '/api/state')).json()).chats.find(c => /Urgências · WhatsApp/.test(c.title))));
    assert.ok(chat, 'a rotina deveria ter rodado com a mensagem como evento');
  } finally {
    child.kill(); evo.close();
  }
});
