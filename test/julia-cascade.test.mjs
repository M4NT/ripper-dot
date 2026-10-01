import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  selectOptimalModel,
  loadBenchmarkCatalog,
  resetBenchmarkCatalogCache,
  estimateTokensFromText,
  inferTaskCategoryFromText
} from '../lib/julia-cascade.mjs';

const miniCatalog = {
  schemaVersion: 1,
  defaultMinSuccessRate: 0.8,
  taskCategories: ['chat_quick', 'coding'],
  models: {
    cheap: {
      provider: 'p1',
      costPerMillionInput: 1,
      costPerMillionOutput: 1,
      competencies: { chat_quick: 0.85, coding: 0.5 }
    },
    strong: {
      provider: 'p2',
      costPerMillionInput: 10,
      costPerMillionOutput: 10,
      competencies: { chat_quick: 0.95, coding: 0.95 }
    },
    tieA: {
      provider: 'p',
      costPerMillionInput: 2,
      costPerMillionOutput: 2,
      avgLatencyMs: 500,
      competencies: { chat_quick: 0.9 }
    },
    tieB: {
      provider: 'p',
      costPerMillionInput: 2,
      costPerMillionOutput: 2,
      avgLatencyMs: 300,
      competencies: { chat_quick: 0.9 }
    }
  }
};

test('selectOptimalModel escolhe menor CPS entre elegíveis', () => {
  const r = selectOptimalModel({
    catalog: miniCatalog,
    taskCategory: 'chat_quick',
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    minSuccessRate: 0.8
  });
  assert.equal(r.modelId, 'cheap');
  assert.ok(r.effectiveCost < selectOptimalModel({
    catalog: miniCatalog,
    taskCategory: 'chat_quick',
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500
  }).candidatesConsidered.find(c => c.modelId === 'strong').effectiveCost);
  assert.equal(r.reason, 'lowest_cps');
});

test('selectOptimalModel filtra competência abaixo do limiar', () => {
  const catalog = {
    defaultMinSuccessRate: 0.85,
    taskCategories: ['coding'],
    models: {
      weak: {
        provider: 'p',
        costPerMillionInput: 1,
        costPerMillionOutput: 1,
        competencies: { coding: 0.7 }
      },
      ace: {
        provider: 'p',
        costPerMillionInput: 20,
        costPerMillionOutput: 20,
        competencies: { coding: 0.84 }
      }
    }
  };
  const r = selectOptimalModel({
    catalog,
    taskCategory: 'coding',
    estimatedInputTokens: 200,
    estimatedOutputTokens: 200,
    minSuccessRate: 0.85
  });
  assert.equal(r.modelId, 'weak');
  assert.equal(r.reason, 'fallback_below_threshold');
  assert.ok(r.fallback);
});

test('selectOptimalModel: catálogo vazio de elegíveis retorna empty_catalog', () => {
  const r = selectOptimalModel({
    catalog: { defaultMinSuccessRate: 0.9, models: { x: { provider: 'p', competencies: {} } } },
    taskCategory: 'chat_quick',
    estimatedInputTokens: 10,
    estimatedOutputTokens: 10
  });
  assert.equal(r.modelId, null);
  assert.equal(r.reason, 'empty_catalog');
});

test('selectOptimalModel desempate por latência quando policy.tieBreak=latency', () => {
  const r = selectOptimalModel({
    catalog: miniCatalog,
    taskCategory: 'chat_quick',
    estimatedInputTokens: 100,
    estimatedOutputTokens: 100,
    policy: { tieBreak: 'latency' },
    allowedModelIds: ['tieA', 'tieB']
  });
  assert.equal(r.modelId, 'tieB');
});

test('loadBenchmarkCatalog lê arquivo customizado', () => {
  resetBenchmarkCatalogCache();
  const dir = mkdtempSync(join(tmpdir(), 'ripper-bench-'));
  const path = join(dir, 'bench.json');
  writeFileSync(path, JSON.stringify(miniCatalog));
  const loaded = loadBenchmarkCatalog({ catalogPath: path });
  assert.equal(loaded.schemaVersion, 1);
  resetBenchmarkCatalogCache();
});

test('inferTaskCategoryFromText detecta código', () => {
  assert.equal(inferTaskCategoryFromText('corrija o bug no npm script'), 'coding');
});

test('estimateTokensFromText é monotônico com tamanho', () => {
  const a = estimateTokensFromText({ prompt: 'a' });
  const b = estimateTokensFromText({ prompt: 'a'.repeat(400) });
  assert.ok(b.estimatedInputTokens > a.estimatedInputTokens);
});

test('recordCascadeDecision persiste em SQLite', () =>
  import('../lib/store.mjs').then(async store => {
    const dir = mkdtempSync(join(tmpdir(), 'ripper-cascade-ev-'));
    const prev = process.env.RIPPER_DATA;
    process.env.RIPPER_DATA = dir;
    store._resetStoreForTests();
    const { _resetJuliaEventsForTests, countCascadeDecisions } = await import('../lib/julia-events.mjs');
    const { recordCascadeDecision } = await import('../lib/julia-cascade.mjs');
    _resetJuliaEventsForTests();
    recordCascadeDecision({
      taskCategory: 'chat_quick',
      modelId: 'cheap',
      provider: 'p1',
      rawCost: 0.001,
      effectiveCost: 0.0012,
      successRate: 0.85,
      candidates: 2,
      reason: 'lowest_cps',
      routedBy: 'test'
    });
    assert.equal(countCascadeDecisions(), 1);
    store._resetStoreForTests();
    _resetJuliaEventsForTests();
    process.env.RIPPER_DATA = prev;
  }));
