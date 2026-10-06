import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseNotes, checkUpdate, applyUpdate } from '../lib/updater.mjs';

// git falso: responde por comando
const fakeGit = (answers, calls = []) => async (cmd, args) => {
  const key = `${cmd} ${args.join(' ')}`;
  calls.push(key);
  for (const [re, out] of answers) if (re.test(key)) { if (out instanceof Error) throw out; return out; }
  return '';
};

test('notas da versão legíveis: sem prefixo técnico nem merges', () => {
  assert.deepEqual(releaseNotes('feat(chat): configuração na conversa\nMerge branch x\nfix: botão cortado'), ['Configuração na conversa', 'Botão cortado']);
});

test('verifica: atrás da versão oficial mostra quantas e as novidades', async () => {
  const r = await checkUpdate('/r', { git: fakeGit([[/rev-parse --abbrev/, 'main'], [/rev-list --count/, '2'], [/git log/, 'feat: a\nfix: b'], [/--short/, 'abc1234']]) });
  assert.equal(r.available, true); assert.equal(r.behind, 2); assert.deepEqual(r.notes, ['A', 'B']);
});

test('verifica: sem Git (instalação sem repositório) não quebra', async () => {
  const r = await checkUpdate('/r', { git: fakeGit([[/./, new Error('not a git repository')]]) });
  assert.equal(r.supported, false);
  assert.equal(r.reason, 'no-git');
});

test('verifica: com Git mas sem acesso à versão oficial avisa que não conseguiu conferir', async () => {
  const r = await checkUpdate('/r', { git: fakeGit([[/rev-parse --abbrev/, 'main'], [/fetch/, new Error('could not resolve host')]]) });
  assert.equal(r.reason, 'offline'); assert.equal(r.available, undefined);
});

test('aplica: recusa se há mudança local; só instala dependências se o package mudou', async () => {
  await assert.rejects(applyUpdate('/r', { git: fakeGit([[/rev-parse --abbrev/, 'main'], [/status/, ' M server.mjs']]) }), /modificados/);
  const calls = [];
  await applyUpdate('/r', { git: fakeGit([[/rev-parse --abbrev/, 'main'], [/diff --name-only/, 'web/src/app.jsx']], calls) });
  assert.ok(calls.some(c => c === 'git merge --ff-only origin/main'));
  assert.ok(!calls.some(c => c.startsWith('npm ci')), 'sem npm ci quando o package não mudou');
  assert.ok(calls.some(c => c === 'npm run build'));
});
