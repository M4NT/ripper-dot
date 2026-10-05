import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDraft, heuristicDraft } from '../lib/agent-draft.mjs';

test('resposta do modelo: JSON no meio do texto, só ferramentas válidas, rotina validada', () => {
  const d = sanitizeDraft('Claro! {"name":"Bia","description":"Atende clientes","category":"Atendimento","instructions":"x","tone":"amigavel","tools":["web","hackear","memory"],"whatsapp":true,"routine":{"dailyAt":"25h","prompt":"y"}} pronto');
  assert.equal(d.name, 'Bia');
  assert.deepEqual(d.tools, ['web', 'memory']);
  assert.equal(d.whatsapp, true);
  assert.equal(d.routine, null, 'horário inválido não vira rotina');
  assert.equal(sanitizeDraft('não sei'), null);
  assert.equal(sanitizeDraft('{"category":"Inventada","tone":"grosso"}').category, 'Outro');
});

test('heurística: frase vira habilidades, WhatsApp e rotina', () => {
  const d = heuristicDraft('Um agente que responde clientes no WhatsApp e todo dia às 9h me manda um resumo das conversas');
  assert.equal(d.category, 'Atendimento');
  assert.equal(d.whatsapp, true);
  assert.deepEqual(d.routine?.dailyAt, '09:00');
  assert.ok(d.tools.includes('routines'));
  const p = heuristicDraft('pesquise concorrentes e monte uma planilha');
  assert.ok(p.tools.includes('web') && p.tools.includes('computer'));
});

test('corrige o modelo: "social" só se a frase pedir publicar; rotina sugerida liga "routines"', () => {
  const d = sanitizeDraft({ name: 'A', tools: ['social', 'memory'], routine: { dailyAt: '18:00', prompt: 'resumo' } }, 'atende clientes da loja no WhatsApp');
  assert.deepEqual(d.tools.sort(), ['memory', 'routines']);
  assert.ok(sanitizeDraft({ tools: ['social'] }, 'publica posts no instagram').tools.includes('social'));
});

test('dia da semana na rotina e planilha liga o computador', () => {
  const h = heuristicDraft('pesquisa concorrentes toda segunda às 9h e monta uma planilha');
  assert.equal(h.routine.weekday, 1);
  assert.equal(h.routine.dailyAt, '09:00');
  assert.ok(h.tools.includes('computer'));
  const m = sanitizeDraft({ tools: ['web'], routine: { dailyAt: '09:00', weekday: 9, prompt: 'x' } }, 'planilha de preços');
  assert.equal(m.routine.weekday, undefined, 'dia inválido vira todo dia');
  assert.ok(m.tools.includes('computer'));
});
