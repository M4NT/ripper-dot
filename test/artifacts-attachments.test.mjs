import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { _resetStoreForTests, dataUrl } from '../lib/store.mjs';
import {
  persistArtifactContent,
  readArtifactContent,
  deleteArtifactStorage,
  purgeOrphanArtifactDirs,
  migrateInlineArtifacts
} from '../lib/artifacts.mjs';
import { discoverBundledSkills, resolveSkillContent, formatSkillsList } from '../lib/skills-runtime.mjs';
import { buildMessageAttachments, attachmentWarnings } from '../lib/attachments.mjs';
import { reconcileFileAttachments } from '../lib/sandbox-lifecycle.mjs';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function withServer(fn) {
  _resetStoreForTests();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-art-'));
  const port = await freePort();
  const env = { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TOKEN: 'art-test-token' };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer art-test-token' };
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/api/health', { headers: auth });
        if (r.ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    await fn(base, auth, dataDir);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
    _resetStoreForTests();
  }
}

test('artefatos: persistência em disco, download e cleanup', async () => {
  process.env.RIPPER_DATA = mkdtempSync(join(tmpdir(), 'ripper-art-unit-'));
  _resetStoreForTests();
  const art = { id: 'art-1', title: 'Plano', kind: 'plano', version: 1, content: 'inline antigo' };
  await migrateInlineArtifacts([art]);
  assert.ok(art.blob);
  assert.equal(art.content, '');
  assert.equal(await readArtifactContent(art), 'inline antigo');
  art.version = 2;
  await persistArtifactContent(art, 'versão 2');
  assert.equal(await readArtifactContent(art), 'versão 2');
  await deleteArtifactStorage(art);
  const orphans = purgeOrphanArtifactDirs(new Set());
  assert.equal(orphans.length, 0);
  art.blob = 'artifacts/art-1/v9.md';
  mkdirSync(dataUrl('artifacts/art-1/'), { recursive: true });
  await writeFile(dataUrl('artifacts/art-1/v9.md'), 'orphan');
  assert.deepEqual(purgeOrphanArtifactDirs(new Set()), ['art-1']);
  _resetStoreForTests();
});

test('skills: descobre bundled e resolve token-the-ripper', () => {
  const found = discoverBundledSkills();
  assert.ok(found.some(s => s.path.includes('token-the-ripper.md')));
  const db = { skills: [] };
  const hit = resolveSkillContent('token-the-ripper', db, null);
  assert.ok(hit?.content.includes('Ação primeiro'));
  assert.match(formatSkillsList(db, null), /token-the-ripper|token the ripper/i);
});

test('anexos: aviso quando arquivo sumiu do disco', async () => {
  process.env.RIPPER_DATA = mkdtempSync(join(tmpdir(), 'ripper-att-'));
  _resetStoreForTests();
  const rel = 'sandbox/agent-1/uploads/x.txt';
  mkdirSync(dataUrl('sandbox/agent-1/uploads/'), { recursive: true });
  await writeFile(dataUrl(rel), 'olá');
  const db = {
    files: [{ id: 'f1', agentId: 'agent-1', name: 'x.txt', type: 'text/plain', size: 3, path: rel }],
    agents: [{ id: 'agent-1', name: 'A' }]
  };
  const agent = { id: 'agent-1' };
  const chat = { id: 'c1' };
  let att = await buildMessageAttachments(db, agent, chat, ['f1']);
  assert.match(att.text, /olá/);
  await reconcileFileAttachments(db);
  assert.equal(db.files.length, 1);
  const { unlink } = await import('node:fs/promises');
  await unlink(dataUrl(rel));
  await reconcileFileAttachments(db);
  assert.equal(db.files.length, 0);
  att = await buildMessageAttachments(db, agent, chat, ['f1']);
  assert.deepEqual(att.missing, ['f1']);
  assert.match(attachmentWarnings(att)[0], /não encontrado/);
  _resetStoreForTests();
});

test('HTTP: upload/download de arquivo e validação de anexo', async () => {
  await withServer(async (base, auth) => {
    const state = await (await fetch(base + '/api/state', { headers: auth })).json();
    const agentId = state.agents[0].id;
    const up = await fetch(base + `/api/files?agentId=${agentId}&name=nota.txt`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'text/plain' },
      body: 'conteúdo do anexo'
    });
    assert.equal(up.status, 200);
    const file = await up.json();
    const dl = await fetch(base + `/api/files/${file.id}`, { headers: auth });
    assert.equal(await dl.text(), 'conteúdo do anexo');

    const noAgent = await fetch(base + '/api/files?name=x.txt', { method: 'POST', headers: { ...auth, 'content-type': 'text/plain' }, body: 'x' });
    assert.equal(noAgent.status, 400);
    assert.match((await noAgent.json()).error, /agentId ou projectId/);
  });
});

test('HTTP: artefato download após seed no db', async () => {
  _resetStoreForTests();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-art-http-'));
  const artId = '00000000-0000-4000-8000-000000000099';
  const seed = {
    schemaVersion: 2,
    settings: { name: '', customInstructions: '', defaultModel: 'auto', memory: true, claude: { mode: 'subscription', apiKey: '', useConnectors: true }, chatgpt: { useConnectedApps: true }, computer: { mode: 'off', boatApiKey: '', vmSize: 'default', idleStopMinutes: 10, allowLocalCommands: false }, julia: { url: 'http://127.0.0.1:8765' }, plugins: [] },
    agents: [{ id: 'a1', name: 'Assistente', description: '', category: 'Outro', status: 'online', instructions: '', tone: 'direto', model: 'auto', effort: 'auto', tools: ['files'], avatar: { type: 'circle', color: null, face: 'eyes' }, templateId: null, vmId: null, createdAt: 1 }],
    chats: [],
    files: [],
    memories: [],
    routines: [],
    projects: [],
    artifacts: [{ id: artId, projectId: null, chatId: null, agentId: 'a1', title: 'Export', kind: 'documento', content: '# seed', version: 1, createdAt: 1, updatedAt: 1 }],
    messages: [],
    approvals: [],
    skills: []
  };
  await writeFile(join(dataDir, 'db.json'), JSON.stringify(seed));
  process.env.RIPPER_DATA = dataDir;
  const port = await freePort();
  const env = { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TOKEN: 'art-test-token' };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer art-test-token' };
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(base + '/api/health', { headers: auth })).ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    const get = await fetch(base + `/api/artifacts/${artId}`, { headers: auth });
    assert.equal(get.status, 200);
    const body = await get.json();
    assert.match(body.content, /seed/);
    const dl = await fetch(base + `/api/artifacts/${artId}/download`, { headers: auth });
    assert.equal(dl.status, 200);
    assert.match(await dl.text(), /seed/);
    await fetch(base + `/api/artifacts/${artId}`, { method: 'DELETE', headers: auth });
    assert.equal((await fetch(base + `/api/artifacts/${artId}`, { headers: auth })).status, 404);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
    _resetStoreForTests();
  }
});

test('HTTP: ciclo artefato via API state + skills catalog', async () => {
  await withServer(async (base, auth) => {
    const skills = await (await fetch(base + '/api/skills/catalog', { headers: auth })).json();
    assert.ok(Array.isArray(skills.skills));
    assert.ok(skills.skills.some(s => s.source === 'bundled'));

    const cleanup = await fetch(base + '/api/computer/cleanup', { method: 'POST', headers: auth });
    assert.equal(cleanup.status, 200);
    const body = await cleanup.json();
    assert.ok(body.files);
  });
});
