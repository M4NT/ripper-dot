import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshotAllProviderCircuitBreakers } from './circuit-breaker.mjs';

export function ripperDataDirUrl() {
  return process.env.RIPPER_DATA
    ? pathToFileURL(resolve(process.env.RIPPER_DATA) + '/')
    : new URL('../data/', import.meta.url);
}

export function dataFileExists(name) {
  try {
    return existsSync(new URL(name, ripperDataDirUrl()));
  } catch {
    return false;
  }
}

/**
 * Snapshot honesto de saúde do processo — sem scores inventados.
 * @param {object} ctx — dependências injetadas (testável).
 */
export async function collectDiagnostics(ctx) {
  const {
    db,
    settings,
    host,
    port,
    tokenConfigured,
    frontendBuilt,
    codexInstalled,
    juliaStatus,
    dockerProbe,
    activeChatCount = 0,
    pendingApprovals = 0
  } = ctx;

  const julia = typeof juliaStatus === 'function' ? await juliaStatus() : juliaStatus;
  const docker = typeof dockerProbe === 'function' ? await dockerProbe() : dockerProbe;
  const codex = typeof codexInstalled === 'function' ? await codexInstalled() : codexInstalled;

  return {
    ok: true,
    at: new Date().toISOString(),
    process: {
      node: process.version,
      pid: process.pid,
      uptimeSec: Math.floor(process.uptime())
    },
    listen: { host, port, auth: tokenConfigured ? 'ripper_token' : 'none' },
    data: {
      dir: process.env.RIPPER_DATA ? 'RIPPER_DATA' : 'default',
      schemaVersion: db?.schemaVersion ?? null,
      dbJson: dataFileExists('db.json'),
      usageSqlite: dataFileExists('usage.sqlite'),
      juliaSqlite: dataFileExists('julia.sqlite'),
      connectionVault: dataFileExists('connection-vault.json'),
      agents: db?.agents?.length ?? 0,
      chats: db?.chats?.length ?? 0,
      projects: db?.projects?.length ?? 0
    },
    runtime: {
      frontendBuilt: !!frontendBuilt,
      codexCli: codex === true ? 'installed' : codex === false ? 'missing' : 'unknown',
      julia: julia?.online ? 'online' : 'offline',
      juliaReason: julia?.reason || julia?.detail || undefined,
      juliaUrl: settings?.julia?.url || undefined,
      docker: docker?.version ? 'available' : docker?.version === null ? 'unavailable' : 'unknown',
      dockerVersion: docker?.version || undefined,
      agentImage: docker?.image || undefined,
      activeChats: activeChatCount,
      pendingApprovals
    },
    providers: {
      circuitBreakers: snapshotAllProviderCircuitBreakers()
    }
  };
}
