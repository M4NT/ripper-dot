// Canal WhatsApp ponta a ponta: verificação do webhook, assinatura, resposta do agente pela "Graph API" falsa.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseWhatsappMessages, normalizeWhatsapp, redactWhatsapp } from '../lib/whatsapp.mjs';

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

test('parse ignora status/mídia e normalize guarda segredos mascarados', () => {
  const body = { entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '5511999', profile: { name: 'Ana' } }],
    messages: [{ id: 'w1', from: '5511999', type: 'text', text: { body: 'oi' } }, { id: 'w2', from: '5511999', type: 'image' }],
    statuses: [{ id: 'x', status: 'read' }]
  } }] }] };
  assert.deepEqual(parseWhatsappMessages(body), [{ id: 'w1', from: '5511999', name: 'Ana', text: 'oi' }]);
  const prev = normalizeWhatsapp({ accessToken: 'tok', appSecret: 'sec', phoneNumberId: '12-3' });
  assert.equal(prev.phoneNumberId, '123');
  const next = normalizeWhatsapp({ accessToken: '••••', appSecret: '••••' }, prev); // a UI devolve o mascarado
  assert.deepEqual([next.accessToken, next.appSecret], ['tok', 'sec']);
  assert.deepEqual([redactWhatsapp(next).accessToken, redactWhatsapp(next).appSecret], ['••••', '••••']);
});

test('webhook WhatsApp: verifica, recusa sem assinatura e responde pela Graph API', async () => {
  const sent = [];
  const graph = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => { sent.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); res.end('{"messages":[{"id":"out1"}]}'); });
  });
  const graphPort = await listen(graph);
  const probe = http.createServer(); const port = await listen(probe); await new Promise(r => probe.close(r)); // porta livre
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-wa-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0', WHATSAPP_GRAPH_URL: `http://127.0.0.1:${graphPort}` },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
    const st = await (await fetch(base + '/api/state')).json();
    const put = body => fetch(base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
    assert.equal((await put({ ui: { mode: 'enterprise' } })).status, 200);
    assert.equal((await put({ whatsapp: { enabled: true, agentId: st.agents[0].id, phoneNumberId: '555', verifyToken: 'vt', accessToken: 'tok', appSecret: 'sec' } })).status, 200);
    const saved = (await (await fetch(base + '/api/state')).json()).settings.whatsapp;
    assert.equal(saved.accessToken, '••••'); // segredo não sai na API

    const hook = base + '/api/channels/whatsapp/webhook';
    assert.equal(await (await fetch(hook + '?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=abc')).text(), 'abc');
    assert.equal((await fetch(hook + '?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=abc')).status, 403);

    const raw = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '5511999', profile: { name: 'Ana' } }], messages: [{ id: 'w1', from: '5511999', type: 'text', text: { body: 'qual o horário?' } }] } }] }] });
    assert.equal((await fetch(hook, { method: 'POST', body: raw, headers: { 'content-type': 'application/json' } })).status, 401);
    const sig = 'sha256=' + createHmac('sha256', 'sec').update(raw).digest('hex');
    const post = () => fetch(hook, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 200); // a Meta reentrega: não pode responder duas vezes
    for (let i = 0; i < 40 && !sent.length; i++) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 500));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, '/555/messages');
    assert.equal(sent[0].auth, 'Bearer tok');
    assert.equal(sent[0].body.to, '5511999');
    assert.ok(sent[0].body.text.body.length > 0);
    const chats = (await (await fetch(base + '/api/state')).json()).chats;
    assert.ok(chats.some(c => c.title === 'WhatsApp · Ana'));
  } finally {
    child.kill(); graph.close();
  }
});
