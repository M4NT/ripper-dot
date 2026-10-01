import { mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { dataUrl } from './store.mjs';

const MAX_CONTENT = 60_000;
const KEEP_VERSIONS = 5;

export function artifactBlobRel(artId, version) {
  return `artifacts/${artId}/v${version}.md`;
}

function blobUrl(artId, version) {
  return dataUrl(artifactBlobRel(artId, version));
}

/** Grava conteúdo em disco; atualiza metadados do artefato (sem manter texto grande no JSON). */
export async function persistArtifactContent(art, content) {
  const text = String(content ?? '').slice(0, MAX_CONTENT);
  const version = art.version || 1;
  mkdirSync(dataUrl(`artifacts/${art.id}/`), { recursive: true });
  const rel = artifactBlobRel(art.id, version);
  await writeFile(blobUrl(art.id, version), text, 'utf8');
  art.blob = rel;
  art.size = text.length;
  art.content = '';
  await pruneOldVersions(art.id, version);
  return text;
}

export async function readArtifactContent(art) {
  if (art.blob) {
    try {
      return await readFile(dataUrl(art.blob), 'utf8');
    } catch (e) {
      if (art.content) return art.content;
      throw new Error(`Artefato "${art.title}": arquivo ausente (${art.blob}).`);
    }
  }
  return art.content ?? '';
}

/** Migra artefatos antigos que ainda tinham content inline. */
export async function migrateInlineArtifacts(artifacts) {
  for (const art of artifacts) {
    if (art.blob || !art.content) continue;
    art.version = art.version || 1;
    await persistArtifactContent(art, art.content);
  }
}

async function pruneOldVersions(artId, current) {
  const dir = dataUrl(`artifacts/${artId}/`);
  if (!existsSync(dir)) return;
  const versions = readdirSync(dir)
    .map(f => /^v(\d+)\.md$/.exec(f))
    .filter(Boolean)
    .map(m => +m[1])
    .sort((a, b) => b - a);
  for (const v of versions.slice(KEEP_VERSIONS)) {
    if (v === current) continue;
    await unlink(blobUrl(artId, v)).catch(() => {});
  }
}

export async function deleteArtifactStorage(art) {
  if (!art?.id) return;
  rmSync(dataUrl(`artifacts/${art.id}/`), { recursive: true, force: true });
}

/** Remove pastas em artifacts/ sem registro correspondente. */
export function purgeOrphanArtifactDirs(knownIds) {
  const root = dataUrl('artifacts/');
  if (!existsSync(root)) return [];
  const removed = [];
  for (const name of readdirSync(root)) {
    if (!knownIds.has(name)) {
      rmSync(new URL(name + '/', root), { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

export function artifactDownloadName(art) {
  const base = String(art.title || 'artefato').replace(/[^\w.\- ()À-ú]/g, '_').slice(0, 80) || 'artefato';
  const ext = art.kind === 'codigo' ? '.txt' : art.kind === 'tabela' ? '.csv' : '.md';
  return base.endsWith(ext) ? base : base + ext;
}
