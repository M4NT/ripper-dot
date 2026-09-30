import test from 'node:test';
import assert from 'node:assert/strict';
import { providerAttemptOrder, runProviderAttemptLoop } from '../lib/provider-turn.mjs';

test('providerAttemptOrder: Claude primário com Codex instalado', () => {
  assert.deepEqual(providerAttemptOrder('claude-sonnet-5-5', true), ['claude-sonnet-5-5', 'codex']);
  assert.deepEqual(providerAttemptOrder('claude-opus-5-5', true), ['claude-opus-5-5', 'codex']);
});

test('providerAttemptOrder: Claude primário sem Codex — sem fallback', () => {
  assert.deepEqual(providerAttemptOrder('claude-sonnet-5-5', false), ['claude-sonnet-5-5']);
});

test('providerAttemptOrder: Codex primário → Claude Sonnet', () => {
  assert.deepEqual(providerAttemptOrder('codex', true), ['codex', 'claude-sonnet-5-5']);
  assert.deepEqual(providerAttemptOrder('codex', false), ['codex', 'claude-sonnet-5-5']);
});

async function* okGen(text) {
  yield { text };
}

async function* partialThenFail(partial) {
  yield { text: partial };
  throw new Error('limite');
}

test('runProviderAttemptLoop: erro sem texto streamed permite fallback', async () => {
  const calls = [];
  const events = [];
  const result = await runProviderAttemptLoop({
    order: ['claude-sonnet-5-5', 'codex'],
    runModel: async function* (m) {
      calls.push(m);
      if (m === 'claude-sonnet-5-5') throw new Error('rate limit');
      yield* okGen('via codex');
    },
    emit: ev => events.push(ev),
    onSuccess: () => {}
  });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'codex');
  assert.equal(result.out, 'via codex');
  assert.deepEqual(calls, ['claude-sonnet-5-5', 'codex']);
  assert.deepEqual(events.filter(e => e.handoff), [{ handoff: 'codex' }]);
});

test('runProviderAttemptLoop: texto parcial bloqueia fallback', async () => {
  const calls = [];
  const result = await runProviderAttemptLoop({
    order: ['claude-sonnet-5-5', 'codex'],
    runModel: async function* (m) {
      calls.push(m);
      yield* partialThenFail('começo da resposta');
    },
    onAttemptFailed: ({ canFallback }) => {
      assert.equal(canFallback, false);
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'limite');
  assert.equal(result.out, 'começo da resposta');
  assert.deepEqual(calls, ['claude-sonnet-5-5']);
});

test('runProviderAttemptLoop: sucesso no primeiro modelo não chama o segundo', async () => {
  const calls = [];
  const result = await runProviderAttemptLoop({
    order: ['claude-sonnet-5-5', 'codex'],
    runModel: async function* (m) {
      calls.push(m);
      yield* okGen('ok claude');
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'claude-sonnet-5-5');
  assert.deepEqual(calls, ['claude-sonnet-5-5']);
});

test('runProviderAttemptLoop: Codex falha e repassa para Claude', async () => {
  const calls = [];
  const events = [];
  const result = await runProviderAttemptLoop({
    order: ['codex', 'claude-sonnet-5-5'],
    runModel: async function* (m) {
      calls.push(m);
      if (m === 'codex') throw new Error('codex down');
      yield* okGen('claude takeover');
    },
    emit: ev => events.push(ev)
  });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'claude-sonnet-5-5');
  assert.deepEqual(events.filter(e => e.handoff), [{ handoff: 'claude-sonnet-5-5' }]);
});

test('runProviderAttemptLoop: última tentativa falha sem texto — sem handoff', async () => {
  const handoffs = [];
  const result = await runProviderAttemptLoop({
    order: ['claude-sonnet-5-5'],
    runModel: async function* () {
      throw new Error('único provedor');
    },
    emit: ev => { if (ev.handoff) handoffs.push(ev.handoff); },
    onAttemptFailed: ({ canFallback }) => assert.equal(canFallback, false)
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'único provedor');
  assert.deepEqual(handoffs, []);
});

test('runProviderAttemptLoop: abort interrompe sem fallback', async () => {
  const ac = new AbortController();
  ac.abort();
  const calls = [];
  const result = await runProviderAttemptLoop({
    order: ['claude-sonnet-5-5', 'codex'],
    signal: ac.signal,
    runModel: async function* (m) {
      calls.push(m);
      throw new Error('não importa');
    },
    onAttemptFailed: ({ aborted }) => assert.equal(aborted, true)
  });
  assert.equal(result.aborted, true);
  assert.deepEqual(calls, ['claude-sonnet-5-5']);
});

test('runProviderAttemptLoop: abort após stream sem throw marca aborted', async () => {
  const ac = new AbortController();
  let stopped;
  const result = await runProviderAttemptLoop({
    order: ['claude-sonnet-5-5', 'codex'],
    signal: ac.signal,
    runModel: async function* () {
      yield { text: 'par' };
      ac.abort();
    },
    onAttemptFailed: ({ aborted, out }) => {
      assert.equal(aborted, true);
      stopped = out;
    }
  });
  assert.equal(result.aborted, true);
  assert.equal(stopped, 'par');
});
