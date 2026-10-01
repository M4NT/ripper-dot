import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  resolveSandboxConfig,
  buildDockerRunArgs,
  execInDockerSandbox,
  wrapComputerExecSandbox,
  sandboxStatus
} from '../lib/exec-sandbox.mjs';
import { applySettingsPatch } from '../lib/settings-patch.mjs';
import { _resetStoreForTests } from '../lib/store.mjs';

test('resolveSandboxConfig: defaults e env RIPPER_SANDBOX_*', () => {
  const keys = ['RIPPER_SANDBOX_ENABLED', 'RIPPER_SANDBOX_IMAGE', 'RIPPER_SANDBOX_NETWORK', 'RIPPER_SANDBOX_MEMORY', 'RIPPER_SANDBOX_CPUS', 'RIPPER_SANDBOX_TIMEOUT_SECONDS'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    process.env.RIPPER_SANDBOX_ENABLED = '1';
    process.env.RIPPER_SANDBOX_IMAGE = 'alpine:3.20';
    process.env.RIPPER_SANDBOX_NETWORK = 'bridge';
    process.env.RIPPER_SANDBOX_MEMORY = '256m';
    process.env.RIPPER_SANDBOX_CPUS = '0.5';
    process.env.RIPPER_SANDBOX_TIMEOUT_SECONDS = '60';
    const c = resolveSandboxConfig({ sandbox: { enabled: false } });
    assert.equal(c.enabled, true);
    assert.equal(c.image, 'alpine:3.20');
    assert.equal(c.network, 'bridge');
    assert.equal(c.memory, '256m');
    assert.equal(c.cpus, '0.5');
    assert.equal(c.timeoutSeconds, 60);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('buildDockerRunArgs: read-only, cap-drop e mount', () => {
  const args = buildDockerRunArgs(
    { image: 'node:22-alpine', network: 'none', memory: '512m', cpus: '1' },
    '/tmp/work'
  );
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--cap-drop'));
  assert.ok(args.includes('ALL'));
  const vi = args.indexOf('-v');
  assert.equal(args[vi + 1], '/tmp/work:/work:rw');
  assert.ok(args.includes('--network'));
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.ok(args.includes('--security-opt'));
  assert.ok(!args.includes('--privileged'));
});

test('execInDockerSandbox: mock docker grava comando', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-sbx-'));
  const work = pathToFileURL(dir + '/');
  mkdirSync(dir, { recursive: true });
  const calls = [];
  const out = await execInDockerSandbox('echo hi', work, { sandbox: { enabled: true } }, {
    probeDocker: async () => '29.0.0',
    dockerRun: async (args) => {
      calls.push(args);
      return { code: 0, out: 'hi\n', err: '' };
    }
  });
  assert.match(out, /hi/);
  assert.match(out, /\[exit 0\]/);
  assert.ok(calls[0].includes('sh'));
  assert.equal(calls[0][calls[0].length - 1], 'echo hi');
});

test('execInDockerSandbox: fallback sem Docker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-sbx-'));
  const work = pathToFileURL(dir + '/');
  const out = await execInDockerSandbox('true', work, { sandbox: { enabled: true } }, {
    probeDocker: async () => null
  });
  assert.match(out, /daemon Docker não está disponível/);
  assert.match(out, /\[exit 127\]/);
});

test('wrapComputerExecSandbox só envolve kind local', () => {
  _resetStoreForTests();
  const agent = { id: 'a1', name: 'Test' };
  const local = { kind: 'local', exec: async () => 'host' };
  const boat = { kind: 'boat', exec: async () => 'boat' };
  const wrapped = wrapComputerExecSandbox(local, agent, { sandbox: { enabled: true } });
  assert.equal(wrapped.sandbox, true);
  assert.notEqual(wrapped.exec, local.exec);
  assert.equal(wrapComputerExecSandbox(boat, agent, { sandbox: { enabled: true } }), boat);
  assert.equal(wrapComputerExecSandbox(local, agent, { sandbox: { enabled: false } }), local);
});

test('applySettingsPatch valida sandbox', () => {
  const s = { defaultModel: 'auto', claude: {}, computer: {}, sandbox: { enabled: false, image: 'node:22-alpine', network: 'none', memory: '512m', cpus: '1', timeoutSeconds: 300 } };
  applySettingsPatch(s, { sandbox: { enabled: true, image: 'node:22-alpine', network: 'none', memory: '1g', cpus: '2', timeoutSeconds: 120 } });
  assert.equal(s.sandbox.enabled, true);
  assert.equal(s.sandbox.memory, '1g');
});

test('sandboxStatus reporta ready quando desligado', async () => {
  const st = await sandboxStatus({ sandbox: { enabled: false } });
  assert.equal(st.ready, true);
  assert.equal(st.enabled, false);
});

test('live docker echo', async t => {
  const { dockerAvailable } = await import('../lib/docker.mjs');
  if (!(await dockerAvailable())) {
    t.skip('Docker daemon ausente');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'ripper-sbx-live-'));
  const work = pathToFileURL(dir + '/');
  const out = await execInDockerSandbox('echo ripper-sbx-live', work, { sandbox: { enabled: true } });
  assert.match(out, /ripper-sbx-live/);
  assert.match(out, /\[exit 0\]/);
});
