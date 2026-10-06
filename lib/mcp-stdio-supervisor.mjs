/**
 * Supervisão de conectores MCP stdio: spawn isolado, detecção de crash, backoff e erros explícitos.
 */

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST_SCRIPT = fileURLToPath(new URL('./mcp-stdio-host.mjs', import.meta.url));

const DEFAULT_BACKOFF = { initialMs: 400, factor: 2, maxMs: 16_000, maxAttempts: 3 };

/** @type {Map<string, { failures: number, cooldownUntil: number, lastError?: string, lastState?: string }>} */
const registry = new Map();

/** @type {Set<import('node:child_process').ChildProcess>} */
const activeHosts = new Set();

export function computeBackoffMs(attempt, opts = {}) {
  const initialMs = opts.initialMs ?? DEFAULT_BACKOFF.initialMs;
  const factor = opts.factor ?? DEFAULT_BACKOFF.factor;
  const maxMs = opts.maxMs ?? DEFAULT_BACKOFF.maxMs;
  const n = Math.max(1, attempt);
  return Math.min(initialMs * Math.pow(factor, n - 1), maxMs);
}

export function stdioSupervisorKey(plugin) {
  if (plugin?.name) return String(plugin.name);
  const cmd = String(plugin?.command || '').trim();
  const args = (plugin?.args || []).map(String).join('\0');
  return `anon:${cmd}:${args}`;
}

export function getStdioSupervisorPublicState(pluginNameOrKey) {
  const st = registry.get(pluginNameOrKey);
  if (!st) return { state: 'idle', failures: 0 };
  const now = Date.now();
  if (st.cooldownUntil > now) {
    return {
      state: 'cooldown',
      failures: st.failures,
      lastError: st.lastError,
      retryAfterMs: st.cooldownUntil - now
    };
  }
  return {
    state: st.lastState || 'idle',
    failures: st.failures,
    lastError: st.lastError
  };
}

export function resetStdioSupervisorState() {
  registry.clear();
}

function recordFailure(key, error, backoffOpts) {
  const prev = registry.get(key) || { failures: 0, cooldownUntil: 0 };
  prev.failures += 1;
  prev.lastError = error;
  prev.lastState = 'crashed';
  const delay = computeBackoffMs(prev.failures, backoffOpts);
  prev.cooldownUntil = Date.now() + delay;
  registry.set(key, prev);
  return { delay, failures: prev.failures };
}

function recordSuccess(key) {
  registry.delete(key);
}

function cooldownBlock(key) {
  const st = registry.get(key);
  if (!st || Date.now() >= st.cooldownUntil) return null;
  return {
    retryAfterMs: st.cooldownUntil - Date.now(),
    failures: st.failures,
    lastError: st.lastError
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Executa uma sonda MCP stdio em processo filho (host) — crash do host/MCP não derruba o Ripper.
 * @returns {Promise<{ ok: boolean, tools?: string[], error?: string, detail?: string, hostCrashed?: boolean, hostExitCode?: number | null }>}
 */
export function runIsolatedStdioProbe(plugin, opts = {}) {
  const command = String(plugin.command || '').trim();
  const args = (plugin.args || []).map(String);
  const timeoutMs = opts.timeout ?? 12_000;
  const hostEnv = opts.hostEnv;

  return new Promise(resolve => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = fork(HOST_SCRIPT, [], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, ...hostEnv },
        windowsHide: true
      });
    } catch (e) {
      finish({ ok: false, error: e?.message || 'Falha ao iniciar host stdio', hostCrashed: true });
      return;
    }

    activeHosts.add(child);

    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish({ ok: false, error: 'timeout no host MCP stdio', hostCrashed: true });
    }, timeoutMs + 8_000);

    const cleanup = () => {
      clearTimeout(killTimer);
      activeHosts.delete(child);
      try {
        child.removeAllListeners();
        if (child.exitCode == null) child.kill('SIGTERM');
      } catch {}
    };

    child.on('message', msg => {
      if (msg?.type === 'host_fatal') {
        cleanup();
        finish({ ok: false, error: msg.error || 'Host MCP encerrou com erro', hostCrashed: true });
        return;
      }
      if (msg?.id !== 1) return;
      cleanup();
      if (msg.ok) {
        finish({ ok: true, tools: msg.tools, readOnlyTools: msg.readOnlyTools, detail: msg.detail });
      } else {
        finish({ ok: false, error: msg.error || 'Falha no stdio', crashed: !!msg.crashed });
      }
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      cleanup();
      finish({
        ok: false,
        error: signal ? `Host encerrado (${signal})` : `Host encerrou (código ${code})`,
        hostCrashed: true,
        hostExitCode: code
      });
    });

    child.on('error', err => {
      if (settled) return;
      cleanup();
      finish({ ok: false, error: err?.message || 'Erro no host', hostCrashed: true });
    });

    try {
      child.send({
        id: 1,
        op: 'probe',
        command,
        args,
        listTools: opts.listTools !== false,
        timeoutMs,
        env: opts.env
      });
    } catch (e) {
      cleanup();
      finish({ ok: false, error: e?.message || 'IPC indisponível', hostCrashed: true });
    }
  });
}

/**
 * Sonda com política de reinício/backoff e bloqueio em cooldown entre chamadas da API.
 */
export async function supervisedStdioProbe(plugin, opts = {}) {
  const key = stdioSupervisorKey(plugin);
  const blocked = cooldownBlock(key);
  if (blocked) {
    const secs = Math.ceil(blocked.retryAfterMs / 1000);
    return {
      ok: false,
      verified: false,
      failureReason: `Conector em recuperação após falha${blocked.lastError ? `: ${blocked.lastError}` : ''}. Aguarde ~${secs}s.`,
      warning: 'Processo MCP stdio falhou recentemente; novas tentativas estão em backoff.',
      supervisor: { state: 'cooldown', ...blocked },
      steps: [
        { id: 'supervisor', status: 'error', detail: `Cooldown (${blocked.retryAfterMs}ms restantes)` }
      ]
    };
  }

  const maxAttempts = opts.maxAttempts ?? DEFAULT_BACKOFF.maxAttempts;
  let last;
  let hostCrashedAny = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(computeBackoffMs(attempt - 1, opts));
    }
    last = await runIsolatedStdioProbe(plugin, opts);
    if (last.ok) {
      recordSuccess(key);
      return {
        probe: last,
        supervisor: { state: 'ok', attempts: attempt, failures: 0 }
      };
    }
    if (last.hostCrashed) hostCrashedAny = true;
    if (!last.hostCrashed) {
      return {
        probe: last,
        supervisor: { state: 'error', attempts: attempt, failures: 0, retried: false }
      };
    }
  }

  const failMsg = last?.error || 'Host MCP stdio indisponível após reinícios.';
  const { delay, failures } = recordFailure(key, failMsg, opts);
  return {
    probe: last,
    supervisor: {
      state: 'crashed',
      attempts: maxAttempts,
      failures,
      cooldownMs: delay,
      hostCrashed: hostCrashedAny
    }
  };
}

export async function shutdownStdioSupervisors() {
  for (const child of activeHosts) {
    try {
      child.send?.({ op: 'shutdown' });
      child.kill('SIGTERM');
    } catch {}
  }
  activeHosts.clear();
  registry.clear();
}
