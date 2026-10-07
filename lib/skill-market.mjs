// Skills de terceiros no Marketplace: o Ripper não embute o código delas. Ao adicionar, baixa do repositório
// do autor (git clone) para data/skills-market/<id>, que os agentes veem em /skills (somente leitura).
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataUrl } from './store.mjs';

export const SKILL_MARKET = [
  {
    id: 'onetake',
    name: 'Vídeo em um plano (onetake)',
    author: 'Patrick · feitangyuan',
    repo: 'https://github.com/feitangyuan/onetake.git',
    home: 'https://github.com/feitangyuan/onetake',
    desc: 'Vídeos curtos de produto em um plano só: câmera que acompanha, ritmo, som e render no computador do agente.',
    license: 'PolyForm Noncommercial 1.0.0',
    licenseNote: 'Gratuita só para uso não comercial. Para usar em vídeos de empresa (comercial), peça licença ao autor.',
    needs: 'computer'
  }
];

export const marketSkillsDir = () => fileURLToPath(dataUrl('skills-market/'));
const dirOf = id => fileURLToPath(dataUrl(`skills-market/${id}/`));
export const isMarketSkillInstalled = id => existsSync(dirOf(id) + 'SKILL.md');

export function listMarketSkills() {
  return SKILL_MARKET.map(s => ({ ...s, installed: isMarketSkillInstalled(s.id) }));
}

/** Baixa a skill do repositório do autor. `run` troca o git nos testes. */
export async function installMarketSkill(id, { run = gitClone } = {}) {
  const s = SKILL_MARKET.find(x => x.id === id);
  if (!s) throw new Error('Skill desconhecida.');
  if (isMarketSkillInstalled(id)) return s;
  mkdirSync(marketSkillsDir(), { recursive: true });
  rmSync(dirOf(id), { recursive: true, force: true });
  const { code, err } = await run(['clone', '--depth', '1', s.repo, dirOf(id)]);
  if (code !== 0 || !isMarketSkillInstalled(id)) {
    rmSync(dirOf(id), { recursive: true, force: true });
    throw new Error('Não consegui baixar a skill do GitHub do autor: ' + (err || '').trim().slice(-200));
  }
  return s;
}

export function uninstallMarketSkill(id) {
  if (!SKILL_MARKET.some(x => x.id === id)) throw new Error('Skill desconhecida.');
  rmSync(dirOf(id), { recursive: true, force: true });
}

function gitClone(args) {
  return new Promise(resolve => {
    const child = spawn('git', args, { shell: false, windowsHide: true });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => resolve({ code: 1, err: e.message }));
    child.on('close', code => resolve({ code, err }));
  });
}
