import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parseModelJson, askWithContract } from '../lib/model-contract.mjs';
import { DRAFT_SCHEMA } from '../lib/agent-draft.mjs';

const S = z.object({ name: z.string(), tone: z.enum(['direto', 'formal']) });

test('parseModelJson: fences, vírgula sobrando, texto em volta, aspas tipográficas', () => {
  assert.deepEqual(parseModelJson('```json\n{"name":"a","tone":"direto"}\n```', S).data, { name: 'a', tone: 'direto' });
  assert.equal(parseModelJson('{"name":"a","tone":"formal",}', S).ok, true);
  assert.equal(parseModelJson('Claro! {"name":"a {x}","tone":"direto"} espero ter ajudado {}', S).data.name, 'a {x}');
  assert.equal(parseModelJson('{\u201Cname\u201D:\u201Ca\u201D,"tone":"direto"}', S).ok, true);
  assert.equal(parseModelJson('sem json', S).ok, false);
});

test('parseModelJson: enum errado cita o campo', () => {
  const r = parseModelJson('{"name":"a","tone":"bravo"}', S);
  assert.equal(r.ok, false);
  assert.match(r.error, /tone/);
});

test('askWithContract: ruim e depois bom → ok com 2 chamadas e erro devolvido', async () => {
  const prompts = [];
  const outs = ['{"name":"a","tone":"x"}', '{"name":"a","tone":"direto"}'];
  const r = await askWithContract({ run: async p => { prompts.push(p); return outs[prompts.length - 1]; }, prompt: 'p', schema: S });
  assert.equal(r.ok, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /não seguiu o formato: tone/);
});

test('askWithContract: sempre ruim → falha após as tentativas', async () => {
  let n = 0;
  const r = await askWithContract({ run: async () => { n++; return 'nada'; }, prompt: 'p', schema: S });
  assert.equal(r.ok, false);
  assert.equal(n, 2);
});

test('DRAFT_SCHEMA rejeita ferramenta inexistente e hora fora do formato', () => {
  const base = { name: 'A', description: 'd', category: 'Outro', instructions: 'i', tone: 'direto', tools: ['web'], whatsapp: false, routine: null };
  assert.equal(DRAFT_SCHEMA.safeParse(base).success, true);
  assert.equal(DRAFT_SCHEMA.safeParse({ ...base, tools: ['voar'] }).success, false);
  assert.equal(DRAFT_SCHEMA.safeParse({ ...base, routine: { dailyAt: '8h', prompt: 'x' } }).success, false);
});
