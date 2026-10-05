// Pasta de trabalho da conversa: uma pasta desta máquina ou um repositório do GitHub.
// No Docker a pasta aparece como /project; no modo local, os comandos rodam nela.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataUrl } from './store.mjs';

export const PROJECT_MOUNT = '/project';
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Pastas que o agente nunca recebe: a própria pasta de dados do Ripper e as do sistema. */
function forbidden(p) {
  const norm = x => resolve(x).toLowerCase() + sep;
  const target = norm(p);
  const data = norm(fileURLToPath(dataUrl('')));
  if (target.startsWith(data) || data.startsWith(target)) return 'a pasta de dados do Ripper (ou uma pasta que a contém)';
  const sys = process.platform === 'win32'
    ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']
    : ['/bin', '/boot', '/dev', '/etc', '/lib', '/proc', '/sbin', '/sys', '/usr', '/var'];
  if (sys.some(s => target.startsWith(norm(s)))) return 'uma pasta do sistema';
  if (target === norm(resolve(p).slice(0, process.platform === 'win32' ? 3 : 1))) return 'a raiz do disco inteiro';
  return null;
}

/** Valida o que veio do navegador. null = sem pasta (área do próprio agente). Lança Error com motivo legível. */
export function normalizeWorkspace(w) {
  if (!w || typeof w !== 'object') return null;
  if (w.kind === 'repo') {
    const repo = String(w.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!REPO_RE.test(repo)) throw new Error('Repositório inválido. Use dono/nome, ex.: minha-empresa/site.');
    return { kind: 'repo', repo };
  }
  if (w.kind === 'folder') {
    const path = String(w.path || '').trim();
    if (!isAbsolute(path)) throw new Error('Informe o caminho completo da pasta.');
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Pasta não encontrada: ${path}`);
    const why = forbidden(path);
    if (why) throw new Error(`Por segurança, o agente não pode trabalhar em ${why}.`);
    return { kind: 'folder', path: resolve(path), readOnly: w.readOnly === true };
  }
  throw new Error('Tipo de pasta de trabalho desconhecido.');
}

/** Branch atual de um repositório git local (lê .git/HEAD; sem rodar git). */
export function gitBranch(path) {
  try {
    const head = readFileSync(join(path, '.git', 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7);
  } catch { return null; }
}

/** Subpastas para o seletor. Sem path: atalhos (pasta pessoal e discos). */
export function listDirs(path) {
  if (!path) {
    const home = homedir();
    const roots = process.platform === 'win32'
      ? 'CDEFGHIJ'.split('').map(l => `${l}:\\`).filter(d => existsSync(d))
      : ['/'];
    const shortcuts = ['Documents', 'Documentos', 'Desktop', 'Área de Trabalho', 'Projects', 'GitHub', join('Documents', 'GitHub')]
      .map(n => join(home, n)).filter(p => existsSync(p));
    return { path: null, parent: null, dirs: [home, ...shortcuts, ...roots].map(p => entry(p, p === home ? 'Pasta pessoal' : basename(p) || p)) };
  }
  if (!isAbsolute(path) || !existsSync(path)) throw new Error(`Pasta não encontrada: ${path}`);
  const dirs = [];
  for (const d of readdirSync(path, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules' || /^\$|^System Volume/.test(d.name)) continue;
    dirs.push(entry(join(path, d.name), d.name));
    if (dirs.length >= 300) break;
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, branch: gitBranch(path), blocked: forbidden(path), dirs };
}

function entry(p, name) {
  return { name, path: p, git: existsSync(join(p, '.git')) };
}

/** Pasta onde os comandos rodam e linha para o prompt do agente. */
export function workspaceFor(ws, computerKind) {
  if (!ws) return { cwd: null, hint: '' };
  if (ws.kind === 'repo') {
    const name = ws.repo.split('/')[1];
    return {
      cwd: computerKind === 'docker' ? `/work/repos/${name}` : null,
      repo: ws.repo,
      hint: `Pasta de trabalho desta conversa: o repositório ${ws.repo}${computerKind === 'docker' ? `, em /work/repos/${name} (já clonado; seus comandos rodam lá)` : ''}. Trabalhe nele; para mudanças, crie um branch e não faça push sem o usuário pedir.`
    };
  }
  const where = computerKind === 'docker' ? `${PROJECT_MOUNT} (é a pasta ${ws.path} da máquina do usuário)` : ws.path;
  return {
    cwd: computerKind === 'docker' ? PROJECT_MOUNT : ws.path,
    hint: `Pasta de trabalho desta conversa: ${where}. Seus comandos rodam nela.${ws.readOnly ? ' Ela está em SOMENTE LEITURA: não tente alterar arquivos; entregue mudanças como arquivo novo com deliver_file.' : ' São arquivos reais do usuário: não apague nada sem ele pedir.'}${gitBranch(ws.path) ? ` É um repositório git (branch ${gitBranch(ws.path)}).` : ''}`
  };
}
