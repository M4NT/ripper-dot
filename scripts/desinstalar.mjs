#!/usr/bin/env node
// Desinstala o Ripper: tira o serviço e os computadores dos agentes. Os dados ficam, a não ser que a pessoa peça.
//   node scripts/desinstalar.mjs                 → mantém os dados (conversas, agentes, contas)
//   node scripts/desinstalar.mjs --apagar-dados  → pergunta e, confirmando, apaga também os dados
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'pipe', windowsHide: true, encoding: 'utf8' });

/** O que guarda dados do usuário: a pasta de dados e as contas do Claude/chave em ~/.ripper. */
export function dataPaths(env = process.env, root = ROOT, home = homedir()) {
  return [env.RIPPER_DATA ? resolve(env.RIPPER_DATA) : join(root, 'data'), join(home, '.ripper')];
}

async function main() {
  const wipe = process.argv.includes('--apagar-dados');
  console.log('Desinstalando o Ripper…');

  const svc = run(process.execPath, [join(ROOT, 'scripts', 'service.mjs'), 'uninstall']);
  console.log(`• Serviço: ${(svc.stdout || '').trim() || 'removido'}`);

  // Computadores dos agentes (contêineres com o rótulo ripper=1), se o Docker existir
  const ids = run('docker', ['ps', '-aq', '--filter', 'label=ripper=1']);
  if (ids.status === 0) {
    const list = ids.stdout.split(/\s+/).filter(Boolean);
    if (list.length) run('docker', ['rm', '-f', ...list]);
    console.log(`• Computadores dos agentes: ${list.length} removido(s)`);
  } else console.log('• Computadores dos agentes: Docker não encontrado, nada a remover');

  const paths = dataPaths().filter(existsSync);
  if (!wipe) {
    console.log(`\nSeus dados foram mantidos:\n${paths.map(p => `  ${p}`).join('\n')}\nInstalando de novo, tudo volta como estava. Para apagar: node scripts/desinstalar.mjs --apagar-dados`);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ok = (await rl.question(`\nIsso apaga para sempre conversas, agentes, memórias e contas conectadas:\n${paths.map(p => `  ${p}`).join('\n')}\nDigite APAGAR para confirmar: `)).trim() === 'APAGAR';
  rl.close();
  if (!ok) { console.log('Nada foi apagado.'); return; }
  for (const p of paths) rmSync(p, { recursive: true, force: true });
  console.log('Dados apagados.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => console.log('\nRipper desinstalado. A pasta do programa pode ser apagada quando quiser.'), e => { console.error(`Não deu certo: ${e.message}`); process.exit(1); });
}
