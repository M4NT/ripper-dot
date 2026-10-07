import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.RIPPER_DATA = mkdtempSync(join(tmpdir(), 'skill-market-'));
const { installMarketSkill, uninstallMarketSkill, listMarketSkills, isMarketSkillInstalled } = await import('../lib/skill-market.mjs');
const { discoverBundledSkills } = await import('../lib/skills-runtime.mjs');

const fakeClone = ok => async args => {
  const dest = args.at(-1);
  if (ok) { mkdirSync(dest, { recursive: true }); writeFileSync(join(dest, 'SKILL.md'), '---\nname: onetake\n---\n# onetake\nFilmes curtos.'); }
  return { code: ok ? 0 : 128, err: ok ? '' : 'fatal: unable to access' };
};

test('cada skill mostra autor, licença e o repositório de onde vem', () => {
  const s = listMarketSkills().find(x => x.id === 'onetake');
  assert.equal(s.license, 'PolyForm Noncommercial 1.0.0');
  assert.match(s.licenseNote, /não comercial/);
  assert.match(s.repo, /^https:\/\/github\.com\/feitangyuan\/onetake/);
  assert.equal(s.installed, false);
});

test('falha no download não deixa skill pela metade', async () => {
  await assert.rejects(installMarketSkill('onetake', { run: fakeClone(false) }), /GitHub do autor/);
  assert.equal(isMarketSkillInstalled('onetake'), false);
});

test('instalada, a skill aparece para os agentes com o caminho /skills; removida, some', async () => {
  const seen = [];
  await installMarketSkill('onetake', { run: async a => { seen.push(a); return fakeClone(true)(a); } });
  assert.deepEqual(seen[0].slice(0, 3), ['clone', '--depth', '1']);
  const s = discoverBundledSkills().find(x => x.source === 'market');
  assert.equal(s.name, 'onetake');
  assert.match(s.content, /\/skills\/onetake/);
  uninstallMarketSkill('onetake');
  assert.equal(discoverBundledSkills().some(x => x.source === 'market'), false);
});

test('id desconhecido é recusado', async () => {
  await assert.rejects(installMarketSkill('../etc', { run: fakeClone(true) }), /desconhecida/);
  assert.throws(() => uninstallMarketSkill('../etc'), /desconhecida/);
});
