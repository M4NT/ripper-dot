import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  lookupSemanticCache,
  storeSemanticCacheEntry,
  resolveSemanticCacheConfig,
  _resetSemanticCacheForTests,
  clearSemanticCache
} from '../lib/semantic-cache.mjs';
import { countSemanticCacheHits, _resetJuliaEventsForTests } from '../lib/julia-events.mjs';
import { applySettingsPatch } from '../lib/settings-patch.mjs';

function withCacheDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-semantic-cache-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  return import('../lib/store.mjs').then(async store => {
    store._resetStoreForTests();
    _resetSemanticCacheForTests();
    _resetJuliaEventsForTests();
    try {
      await fn();
    } finally {
      clearSemanticCache();
      store._resetStoreForTests();
      _resetSemanticCacheForTests();
      _resetJuliaEventsForTests();
      process.env.RIPPER_DATA = prev;
    }
  });
}

const baseCfg = {
  enabled: true,
  minScore: 0.88,
  ttlMs: 3600_000,
  maxEntries: 50,
  embedDim: 256
};

test('semantic cache: miss em cache vazio', () =>
  withCacheDir(async () => {
    const r = lookupSemanticCache({
      agentId: 'a1',
      model: 'claude-sonnet-5-5',
      question: 'Qual a capital da França?',
      context: '',
      config: baseCfg
    });
    assert.equal(r.hit, false);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(countSemanticCacheHits(), 1);
  }));

test('semantic cache: hit após gravar resposta', () =>
  withCacheDir(async () => {
    storeSemanticCacheEntry({
      agentId: 'a1',
      model: 'claude-sonnet-5-5',
      question: 'Qual a capital da França?',
      context: '',
      answer: 'Paris.',
      effort: 'low',
      config: baseCfg
    });
    const r = lookupSemanticCache({
      agentId: 'a1',
      model: 'claude-sonnet-5-5',
      question: 'Qual a capital da França?',
      context: '',
      config: baseCfg
    });
    assert.equal(r.hit, true);
    assert.equal(r.answer, 'Paris.');
    assert.ok(r.score >= baseCfg.minScore);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(countSemanticCacheHits(), 1);
  }));

test('semantic cache: pergunta diferente não atinge limiar', () =>
  withCacheDir(async () => {
    storeSemanticCacheEntry({
      agentId: 'a1',
      model: 'claude-sonnet-5-5',
      question: 'Explique física quântica em detalhe',
      context: '',
      answer: 'Resposta longa sobre elétrons.',
      config: baseCfg
    });
    const strict = { ...baseCfg, minScore: 0.95 };
    const r = lookupSemanticCache({
      agentId: 'a1',
      model: 'claude-sonnet-5-5',
      question: 'Receita de bolo de chocolate',
      context: '',
      config: strict
    });
    assert.equal(r.hit, false);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(countSemanticCacheHits(), 1);
  }));

test('semantic cache: desligado ignora entradas', () =>
  withCacheDir(async () => {
    storeSemanticCacheEntry({
      agentId: 'a1',
      model: 'claude-sonnet-5-5',
      question: 'oi',
      context: '',
      answer: 'olá',
      config: baseCfg
    });
    const r = lookupSemanticCache({
      agentId: 'a1',
      model: 'claude-sonnet-5-5',
      question: 'oi',
      context: '',
      config: { ...baseCfg, enabled: false }
    });
    assert.equal(r.hit, false);
  }));

test('resolveSemanticCacheConfig e settings patch', () => {
  const s = {
    julia: { url: 'http://127.0.0.1:8765', semanticCache: { enabled: false } }
  };
  applySettingsPatch(s, { julia: { semanticCache: { enabled: true, minScore: 0.9 } } });
  assert.equal(s.julia.semanticCache.enabled, true);
  assert.equal(s.julia.semanticCache.minScore, 0.9);
  const cfg = resolveSemanticCacheConfig(s);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.minScore, 0.9);
});
