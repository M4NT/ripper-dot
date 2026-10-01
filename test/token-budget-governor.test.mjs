import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withUsageDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-budget-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  return import('../lib/store.mjs').then(async store => {
    const { _resetUsageEventsForTests } = await import('../lib/usage-events.mjs');
    store._resetStoreForTests();
    _resetUsageEventsForTests();
    const usage = await import('../lib/usage.mjs');
    const gov = await import('../lib/token-budget-governor.mjs');
    return Promise.resolve(fn({ ...usage, ...gov })).finally(() => {
      store._resetStoreForTests();
      _resetUsageEventsForTests();
      process.env.RIPPER_DATA = prev;
    });
  });
}

const settingsUnder = {
  tokenBudget: {
    enabled: true,
    periodHours: 24,
    globalMaxTokens: 100,
    agents: {},
    loopDetection: { enabled: false }
  }
};

test('governor desligado não bloqueia com uso alto', () =>
  withUsageDataDir(({ recordUsage, checkTokenBudget }) => {
    const db = {};
    recordUsage(db, 'codex', { charsIn: 1_000_000, charsOut: 0 });
    const r = checkTokenBudget({ tokenBudget: { enabled: false, globalMaxTokens: 10 } });
    assert.equal(r.blocked, false);
  }));

test('governor bloqueia acima do orçamento global (eventos reais)', () =>
  withUsageDataDir(({ recordUsage, checkTokenBudget, tokensFromChars }) => {
    const db = {};
    const chars = 500;
    recordUsage(db, 'codex', { charsIn: chars, charsOut: 0 });
    const used = tokensFromChars(chars);
    const r = checkTokenBudget(settingsUnder);
    assert.equal(r.blocked, used >= 100);
    if (r.blocked) {
      assert.equal(r.kind, 'token_budget');
      assert.match(r.userMessage, /Orçamento/);
      assert.equal(r.status.exceeded[0].scope, 'global');
    }
  }));

test('governor permite abaixo do orçamento', () =>
  withUsageDataDir(({ recordUsage, checkTokenBudget }) => {
    const db = {};
    recordUsage(db, 'codex', { charsIn: 40, charsOut: 0, agentId: 'a1' });
    const r = checkTokenBudget(settingsUnder);
    assert.equal(r.blocked, false);
    assert.equal(r.status.ok, true);
  }));

test('orçamento por agente usa agentId nos eventos', () =>
  withUsageDataDir(({ recordUsage, checkTokenBudget }) => {
    const db = {};
    recordUsage(db, 'codex', { charsIn: 800, charsOut: 0, agentId: 'agent-a' });
    recordUsage(db, 'codex', { charsIn: 800, charsOut: 0, agentId: 'agent-b' });
    const settings = {
      tokenBudget: {
        enabled: true,
        globalMaxTokens: null,
        agents: { 'agent-a': { maxTokens: 50 } },
        loopDetection: { enabled: false }
      }
    };
    const okB = checkTokenBudget(settings, { agentId: 'agent-b' });
    assert.equal(okB.blocked, false);
    const hitA = checkTokenBudget(settings, { agentId: 'agent-a' });
    assert.equal(hitA.blocked, true);
    assert.equal(hitA.scope, 'agent');
  }));

test('loop detector opcional dispara após repetições', async () => {
  const { ToolLoopDetector } = await import('../lib/token-budget-governor.mjs');
  const det = new ToolLoopDetector({
    enabled: true,
    globalMaxTokens: 1,
    loopDetection: { enabled: true, sameToolThreshold: 4, windowSeconds: 60 }
  });
  let last = { loop: false };
  for (let i = 0; i < 3; i++) last = det.observe('read_file');
  assert.equal(last.loop, false);
  last = det.observe('read_file');
  assert.equal(last.loop, true);
  assert.ok(last.message.includes('read_file'));
});

test('applySettingsPatch normaliza tokenBudget', async () => {
  const { applySettingsPatch } = await import('../lib/settings-patch.mjs');
  const s = { defaultModel: 'auto', claude: {}, computer: {}, tokenBudget: {} };
  applySettingsPatch(s, {
    tokenBudget: {
      enabled: true,
      globalMaxTokens: 5000,
      agents: { x: { maxTokens: 100 } },
      loopDetection: { enabled: true, sameToolThreshold: 99 }
    }
  });
  assert.equal(s.tokenBudget.enabled, true);
  assert.equal(s.tokenBudget.globalMaxTokens, 5000);
  assert.equal(s.tokenBudget.loopDetection.sameToolThreshold, 30);
});
