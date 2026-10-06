// Atualização do Ripper pela própria interface: vê se há versão nova no Git, mostra as novidades e aplica.
// Só avança (fast-forward): nunca sobrescreve mudança local. Depois de aplicar, o vigia sobe a versão nova.
import { execFile } from 'node:child_process';

const sh = (cmd, args, cwd, timeout = 120_000) => new Promise((resolve, reject) =>
  execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 << 20, shell: cmd === 'npm' && process.platform === 'win32' },
    (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr: String(stderr || '') })) : resolve(String(stdout).trim())));

/** Linhas do git log viram notas legíveis: "feat(chat): algo" → "algo". */
export function releaseNotes(log) {
  return String(log || '').split('\n').map(l => l.trim()).filter(Boolean)
    .filter(l => !/^Merge (branch|pull request)/i.test(l))
    .map(l => l.replace(/^\w+(\([^)]*\))?!?:\s*/, ''))
    .map(l => l.charAt(0).toUpperCase() + l.slice(1))
    .slice(0, 30);
}

export async function checkUpdate(root, { git = sh } = {}) {
  let branch;
  try { branch = await git('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root); }
  catch { return { supported: false, reason: 'no-git', checkedAt: Date.now() }; }
  try {
    await git('git', ['fetch', '--quiet', 'origin', branch], root, 60_000);
    const behind = Number(await git('git', ['rev-list', '--count', `HEAD..origin/${branch}`], root)) || 0;
    const notes = behind ? releaseNotes(await git('git', ['log', '--format=%s', `HEAD..origin/${branch}`], root)) : [];
    const current = await git('git', ['rev-parse', '--short', 'HEAD'], root);
    return { supported: true, branch, current, behind, available: behind > 0, notes, checkedAt: Date.now() };
  } catch (e) {
    return { supported: true, branch, reason: 'offline', error: (e.stderr || e.message || '').split('\n')[0].slice(0, 200), checkedAt: Date.now() };
  }
}

/** Aplica a versão nova. onStep recebe o passo atual (para mostrar progresso). Lança erro legível se não der. */
export async function applyUpdate(root, { git = sh, onStep = () => {} } = {}) {
  const branch = await git('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const dirty = (await git('git', ['status', '--porcelain', '--untracked-files=no'], root)).trim();
  if (dirty) throw new Error('Há arquivos do Ripper modificados nesta máquina; atualize manualmente para não perder essas mudanças.');
  onStep('Baixando a versão nova');
  await git('git', ['fetch', '--quiet', 'origin', branch], root, 60_000);
  const before = await git('git', ['rev-parse', 'HEAD'], root);
  try { await git('git', ['merge', '--ff-only', `origin/${branch}`], root); }
  catch { throw new Error('A versão desta máquina se separou da oficial; atualize manualmente.'); }
  const changed = await git('git', ['diff', '--name-only', before, 'HEAD'], root);
  if (/^package(-lock)?\.json$/m.test(changed)) { onStep('Instalando dependências'); await git('npm', ['ci', '--no-audit', '--no-fund'], root, 600_000); }
  onStep('Montando o app');
  await git('npm', ['run', 'build'], root, 300_000);
  return { from: before.slice(0, 7), to: (await git('git', ['rev-parse', '--short', 'HEAD'], root)) };
}
