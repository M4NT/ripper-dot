import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeWorkspace, listDirs, gitBranch, workspaceFor } from '../lib/workspace.mjs';

test('pasta de trabalho: valida caminho, recusa sistema/dados do Ripper, aceita repositório', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-ws-'));
  assert.deepEqual(normalizeWorkspace({ kind: 'folder', path: dir, readOnly: true }), { kind: 'folder', path: dir, readOnly: true });
  assert.throws(() => normalizeWorkspace({ kind: 'folder', path: 'relativa' }), /caminho completo/);
  assert.throws(() => normalizeWorkspace({ kind: 'folder', path: join(dir, 'nao-existe') }), /não encontrada/);
  assert.throws(() => normalizeWorkspace({ kind: 'folder', path: process.platform === 'win32' ? 'C:\\Windows' : '/etc' }), /sistema/);
  assert.throws(() => normalizeWorkspace({ kind: 'folder', path: process.platform === 'win32' ? 'C:\\' : '/' }), /raiz|sistema/);
  assert.deepEqual(normalizeWorkspace({ kind: 'repo', repo: 'https://github.com/dono/site.git' }), { kind: 'repo', repo: 'dono/site' });
  assert.throws(() => normalizeWorkspace({ kind: 'repo', repo: 'site' }), /dono\/nome/);
  assert.equal(normalizeWorkspace(null), null);
});

test('lista subpastas, marca repositórios git e lê o branch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-ws-'));
  mkdirSync(join(dir, 'app', '.git'), { recursive: true });
  writeFileSync(join(dir, 'app', '.git', 'HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(join(dir, 'node_modules')); mkdirSync(join(dir, '.oculta')); mkdirSync(join(dir, 'docs'));
  const r = listDirs(dir);
  assert.deepEqual(r.dirs.map(d => [d.name, d.git]), [['app', true], ['docs', false]]);
  assert.equal(gitBranch(join(dir, 'app')), 'main');
  assert.equal(workspaceFor({ kind: 'folder', path: join(dir, 'app') }, 'docker').cwd, '/project');
  assert.match(workspaceFor({ kind: 'folder', path: dir, readOnly: true }, 'local').hint, /SOMENTE LEITURA/);
  assert.equal(workspaceFor({ kind: 'repo', repo: 'dono/site' }, 'docker').cwd, '/work/repos/site');
  assert.ok(listDirs('').dirs.length > 0, 'atalhos iniciais');
});
