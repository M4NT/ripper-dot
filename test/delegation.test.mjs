import test from 'node:test';
import assert from 'node:assert/strict';
import { delegationTasks } from '../lib/agent-flow.mjs';

test('delegationTasks: frase com @Nome vira tarefa curta', () => {
  const peers = [{ id: 'b', name: 'Bruno' }, { id: 'c', name: 'Carla' }];
  const text = 'Vou montar o plano. @Bruno, pesquisar preços dos fornecedores!\n@Carla revisa o texto final ' + 'x'.repeat(100);
  const r = delegationTasks(text, peers);
  assert.deepEqual(r[0], { to: 'b', task: 'pesquisar preços dos fornecedores!' });
  assert.equal(r[1].to, 'c');
  assert.ok(r[1].task.startsWith('revisa o texto') && r[1].task.length <= 80 && r[1].task.endsWith('…'));
  assert.deepEqual(delegationTasks('oi', [{ id: 'z', name: 'Zé' }]), [{ to: 'z', task: '' }]);
  assert.equal(delegationTasks('@Brunoo faz', [{ id: 'b', name: 'Bruno' }])[0].task, '');
});
