import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseTeamBrief,
  normalizeTeamStructure,
  orchestrateTeamStructure,
  createTeamProposal,
  applyTeamProposal,
  teamStructureFromArchitectGoal
} from '../lib/team-orchestrator.mjs';

test('parseTeamBrief: lista em linguagem natural → estrutura normalizada', () => {
  const brief = `Time: Campanha de lançamento
- Estrategista: define posicionamento e público
- Redatora: escreve slogans e posts
Estrategista -> Redatora: delega textos curtos`;
  const s = parseTeamBrief(brief);
  assert.equal(s.title, 'Campanha de lançamento');
  assert.equal(s.agents.length, 2);
  assert.equal(s.agents[0].name, 'Estrategista');
  assert.ok(s.agents.every(a => a.key && a.tools.length));
  assert.equal(s.inboxLinks.length, 1);
  assert.equal(s.inboxLinks[0].kind, 'delegate');
});

test('teamStructureFromArchitectGoal alinha com Architect suggest', () => {
  const s = teamStructureFromArchitectGoal('time multi-agente para qualificar leads e escrever propostas comerciais');
  assert.ok(s.agents.length >= 2);
  assert.equal(s.version, 1);
});

test('parseTeamBrief: bloco JSON embutido', () => {
  const brief = `Quero isto:
\`\`\`json
{
  "title": "Ops",
  "roles": [{ "id": "lead", "name": "Líder", "purpose": "Prioriza" }],
  "agents": [
    { "key": "lead", "name": "Líder", "roleId": "lead", "description": "Coordena", "permissions": { "hint": "admin futuro" } }
  ]
}
\`\`\``;
  const s = parseTeamBrief(brief);
  assert.equal(s.title, 'Ops');
  assert.equal(s.roles[0].id, 'lead');
  assert.deepEqual(s.agents[0].permissions, { hint: 'admin futuro' });
});

test('orchestrateTeamStructure com RIPPER_TEST_PROVIDER=team', async () => {
  const prev = process.env.RIPPER_TEST_PROVIDER;
  process.env.RIPPER_TEST_PROVIDER = 'team';
  try {
    const s = await orchestrateTeamStructure('Preciso de um time mínimo', {});
    assert.equal(s.agents.length, 2);
    assert.equal(s.inboxLinks[0].fromKey, 'coord');
  } finally {
    process.env.RIPPER_TEST_PROVIDER = prev;
  }
});

test('applyTeamProposal cria agentes, projeto e teamBinding', async () => {
  const { _resetStoreForTests, load, flush } = await import('../lib/store.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ripper-team-'));
  process.env.RIPPER_DATA = dir;
  _resetStoreForTests();
  const db = load();
  const structure = normalizeTeamStructure({
    title: 'Time QA',
    projectName: 'Projeto QA',
    agents: [
      { key: 'm', name: 'Manager', description: 'Gestor', managerKey: null },
      { key: 'w', name: 'Worker', description: 'Executa', managerKey: 'm' }
    ],
    inboxLinks: [{ fromKey: 'm', toKey: 'w', kind: 'delegate' }]
  });
  const proposal = createTeamProposal(db, { brief: 'teste', structure });
  const { agents, project } = applyTeamProposal(db, proposal.id);
  assert.equal(agents.length, 2);
  assert.equal(project.agentIds.length, 2);
  const manager = agents.find(a => a.name === 'Manager');
  const worker = agents.find(a => a.name === 'Worker');
  assert.equal(worker.teamBinding.managerId, manager.id);
  assert.match(manager.instructions, /send_message/);
  await flush();
  _resetStoreForTests();
  delete process.env.RIPPER_DATA;
});
