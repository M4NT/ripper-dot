// Uma sandbox boat.dev por agente. Parada/snapshot após N minutos ociosa.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dataUrl } from './store.mjs';

const BASE = process.env.BOAT_API_URL || 'https://boat.dev/api/v1';
const idleTimers = new Map();

async function api(key, method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(path.endsWith('/commands') ? 310_000 : 30_000)
  });
  if (!r.ok) throw new Error(`boat ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export function computerFor(agent, settings, onChange) {
  const c = settings.computer;
  if (c.mode === 'off') return null;
  if (c.mode === 'local') return c.allowLocalCommands ? localComputer(agent) : null;

  const key = c.boatApiKey || process.env.BOAT_API_KEY;
  if (!key) throw new Error('Configure a Boat API key em Configurações → Computador.');

  const ensure = async () => {
    if (!agent.vmId) {
      const result = await api(key, 'POST', '/sandboxes', { type: c.vmSize });
      agent.vmId = result.sandbox.id;
      onChange();
    }
    const vm = (await api(key, 'GET', `/sandboxes/${agent.vmId}`)).sandbox;
    if (vm.state === 'archived') await api(key, 'POST', `/sandboxes/${agent.vmId}/resume`, {});
    else if (['error', 'cancelled'].includes(vm.state)) throw new Error(`Boat: sandbox em estado ${vm.state}.`);
    clearTimeout(idleTimers.get(agent.id));
    const idle = setTimeout(
      () => api(key, 'POST', `/sandboxes/${agent.vmId}/stop`, {}).catch(() => {}),
      c.idleStopMinutes * 60_000
    );
    idle.unref();
    idleTimers.set(agent.id, idle);
  };

  return {
    kind: 'boat',
    async exec(command) {
      await ensure();
      const r = await api(key, 'POST', `/sandboxes/${agent.vmId}/commands`, { command, cwd: '/home/user', timeoutSeconds: 300 });
      return `${r.stdout ?? ''}${r.stderr ?? ''}\n[exit ${r.exitCode}]`;
    },
    async writeFile(name, bytes) {
      await ensure();
      await api(key, 'POST', `/sandboxes/${agent.vmId}/commands`, { command: 'mkdir -p /home/user/uploads', timeoutSeconds: 30 });
      return api(key, 'PUT', `/sandboxes/${agent.vmId}/files`, { path: `/home/user/uploads/${name}`, content: bytes.toString('base64'), encoding: 'base64' });
    },
    async share(port) {
      await ensure();
      return (await api(key, 'POST', `/sandboxes/${agent.vmId}/host`, { port, public: true })).url;
    },
    async status() {
      if (!agent.vmId) return 'not started';
      try { return (await api(key, 'GET', `/sandboxes/${agent.vmId}`)).sandbox.state; } catch { return 'unknown'; }
    }
  };
}

function localComputer(agent) {
  const cwd = dataUrl(`sandbox/${agent.id}/`);
  mkdirSync(cwd, { recursive: true });
  return {
    kind: 'local',
    exec: command => new Promise((res, reject) => {
      const p = spawn(command, { cwd, shell: true, timeout: 300_000 });
      let out = '';
      p.stdout.on('data', d => { if (out.length < 100_000) out += d; });
      p.stderr.on('data', d => { if (out.length < 100_000) out += d; });
      p.on('error', reject);
      p.on('close', code => res(`${out}\n[exit ${code}]`));
    }),
    share: async port => `http://localhost:${port}`,
    status: async () => 'local'
  };
}
