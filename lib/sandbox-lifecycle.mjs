import { existsSync, readdirSync, rmSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dataUrl } from './store.mjs';
import { purgeOrphanArtifactDirs } from './artifacts.mjs';
import { dockerAvailable } from './docker.mjs';

export function ripperContainerName(agentId) {
  return `ripper-${agentId.slice(0, 12)}`;
}

function docker(args, timeout = 30_000) {
  return new Promise(resolve => {
    const p = spawn('docker', args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', d => { if (out.length < 20_000) out += d; });
    p.stderr.on('data', d => { if (err.length < 4000) err += d; });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out: '', err: e.message }); });
    p.on('close', code => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

export async function removeDockerContainer(agentId) {
  const name = ripperContainerName(agentId);
  const r = await docker(['rm', '-f', name]);
  if (r.code !== 0 && !/No such container/.test(r.err)) return { ok: false, error: r.err.trim().slice(-200) || 'docker rm falhou' };
  return { ok: true };
}

export function removeSandboxDir(agentId) {
  const dir = dataUrl(`sandbox/${agentId}/`);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function removeProjectSandboxDir(projectId) {
  const dir = dataUrl(`sandbox/project-${projectId}/`);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Arquivos no db sem blob no disco → remove registro. Blobs em uploads/ sem registro → apaga. */
export async function reconcileFileAttachments(db) {
  const knownPaths = new Set(db.files.map(f => f.path));
  const removedRecords = [];
  const missingOnDisk = [];
  db.files = db.files.filter(f => {
    if (!existsSync(dataUrl(f.path))) {
      missingOnDisk.push(f.id);
      removedRecords.push(f.id);
      return false;
    }
    return true;
  });
  const orphanBlobs = [];
  const sandboxRoot = dataUrl('sandbox/');
  if (existsSync(sandboxRoot)) {
    for (const ent of readdirSync(sandboxRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const uploads = new URL(`${ent.name}/uploads/`, sandboxRoot);
      if (!existsSync(uploads)) continue;
      for (const name of readdirSync(uploads)) {
        const rel = `sandbox/${ent.name}/uploads/${name}`;
        if (!knownPaths.has(rel)) {
          orphanBlobs.push(rel);
          await unlink(new URL(name, uploads)).catch(() => {});
        }
      }
    }
  }
  return { removedRecords, missingOnDisk, orphanBlobs };
}

export async function cleanupAgentResources(agent, settings) {
  return {
    sandboxDir: removeSandboxDir(agent.id),
    docker: settings.computer?.mode === 'docker' ? await removeDockerContainer(agent.id) : null
  };
}

async function removeStaleDockerContainers(agentIds) {
  const r = await docker(['ps', '-a', '--filter', 'label=ripper=1', '--format', '{{.Names}}|{{.Label "ripper.agent"}}']);
  if (r.code !== 0) return { ok: false, error: r.err.trim().slice(-200), removed: [] };
  const removed = [];
  for (const line of r.out.trim().split('\n').filter(Boolean)) {
    const [name, aid] = line.split('|');
    if (!aid || agentIds.has(aid)) continue;
    const rm = await docker(['rm', '-f', name]);
    if (rm.code === 0) removed.push(name);
  }
  return { ok: true, removed };
}

/** Limpeza leve na subida: órfãos de artefatos, anexos e contêineres Docker sem agente. */
export async function startupStorageCleanup(db) {
  const artifactIds = new Set((db.artifacts || []).map(a => a.id));
  const artifacts = purgeOrphanArtifactDirs(artifactIds);
  const files = await reconcileFileAttachments(db);
  let docker = null;
  if (await dockerAvailable()) {
    docker = await removeStaleDockerContainers(new Set(db.agents.map(a => a.id)));
  }
  return { artifacts, files, docker };
}
