import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

async function withRoiDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-token-roi-'));
  const prev = process.env.RIPPER_DATA;
  process.env.RIPPER_DATA = dir;
  const store = await import('../lib/store.mjs');
  const { _resetUsageEventsForTests } = await import('../lib/usage-events.mjs');
  const { _resetJuliaEventsForTests } = await import('../lib/julia-events.mjs');
  const { _resetTokenRoiForTests } = await import('../lib/token-roi.mjs');
  store._resetStoreForTests();
  _resetUsageEventsForTests();
  _resetJuliaEventsForTests();
  _resetTokenRoiForTests();
  try {
    return await fn();
  } finally {
    store._resetStoreForTests();
    _resetUsageEventsForTests();
    _resetJuliaEventsForTests();
    _resetTokenRoiForTests();
    process.env.RIPPER_DATA = prev;
  }
}

test('buildTokenRoiContract vazio — sem dados, sem campos monetários', () =>
  withRoiDir(async () => {
    const { buildTokenRoiContract } = await import('../lib/token-roi.mjs');
    const roi = buildTokenRoiContract();
    assert.equal(roi.available, false);
    assert.equal(roi.emptyLabel, 'sem dados');
    assert.equal(roi.usageEvents, null);
    assert.equal(roi.juliaDecisions, null);
    assert.equal(roi.cascade.present, false);
    assert.equal(roi.semanticCache.present, false);
    assert.equal(roi.usdAvoided, undefined);
    assert.equal(roi.savingsPct, undefined);
    assert.ok(roi.note.includes('US$'));
  }));

test('buildTokenRoiContract com fixture — usage, Julia, cascade e cache', () =>
  withRoiDir(async () => {
    const { recordUsage } = await import('../lib/usage.mjs');
    const { appendJuliaDecision } = await import('../lib/julia-events.mjs');
    const { buildTokenRoiContract } = await import('../lib/token-roi.mjs');
    const { fileURLToPath } = await import('node:url');
    const { dataUrl } = await import('../lib/store.mjs');

    const db = {};
    recordUsage(db, 'claude-sonnet-5-5', { charsIn: 800, charsOut: 200, routedBy: 'julia-1' });
    appendJuliaDecision({
      purpose: 'route',
      latencyMs: 12,
      optionCount: 3,
      ok: true,
      score: 0.9,
      avoidedPromptChars: 300
    });

    const juliaPath = fileURLToPath(dataUrl('julia.sqlite'));
    const sqlite = new DatabaseSync(juliaPath);
    sqlite.exec(`
      CREATE TABLE cascade_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        decision TEXT NOT NULL,
        ok INTEGER NOT NULL DEFAULT 1,
        reason TEXT,
        saved_chars INTEGER,
        tier_from TEXT,
        tier_to TEXT
      );
      CREATE TABLE semantic_cache_hits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        hit INTEGER NOT NULL,
        saved_chars INTEGER,
        purpose TEXT
      );
    `);
    const t = Date.now();
    sqlite.prepare(
      'INSERT INTO cascade_decisions (at, decision, ok, saved_chars, tier_from, tier_to) VALUES (?, ?, 1, ?, ?, ?)'
    ).run(t, 'stop_early', 500, 'large', 'small');
    sqlite.prepare(
      'INSERT INTO semantic_cache_hits (at, hit, saved_chars, purpose) VALUES (?, 1, ?, ?)'
    ).run(t, 900, 'speaker');
    sqlite.close();

    const roi = buildTokenRoiContract();
    assert.equal(roi.available, true);
    assert.equal(roi.emptyLabel, null);
    assert.equal(roi.usageEvents.events, 1);
    assert.equal(roi.usageEvents.routedByJulia, 1);
    assert.equal(roi.juliaDecisions.decisions, 1);
    assert.equal(roi.cascade.total, 1);
    assert.equal(roi.cascade.savedChars.sum, 500);
    assert.equal(roi.semanticCache.hits, 1);
    assert.equal(roi.semanticCache.misses, 0);
    assert.equal(roi.semanticCache.savedChars.sum, 900);
    assert.equal(roi.savingsPct, undefined);
    assert.ok(roi.cascade.recent.length >= 1);
  }));

test('buildUsageContract inclui tokenRoi', () =>
  withRoiDir(async () => {
    const { buildUsageContract } = await import('../lib/usage-api.mjs');
    const db = { chats: [], agents: [], skills: [], memories: [], settings: { plugins: [] } };
    const bundle = buildUsageContract(db, db.settings);
    assert.ok(bundle.tokenRoi);
    assert.equal(bundle.tokenRoi.emptyLabel, 'sem dados');
  }));
