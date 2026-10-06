import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAnthropicRateLimitHeaders,
  normalizeOAuthUsageBody,
  normalizeSdkGetUsageResponse,
  mergeSubscriptionWindows,
  claudeAuthMode,
  recordClaudeSubscriptionSnapshot,
  claudeSubscriptionView,
  refreshClaudeSubscriptionUsage,
  clearClaudeOAuthUsageCache
} from '../lib/claude-subscription-usage.mjs';
import { accountLimits } from '../lib/usage.mjs';

test('parseAnthropicRateLimitHeaders converte 0–1 em %', () => {
  const h = parseAnthropicRateLimitHeaders({
    'anthropic-ratelimit-unified-5h-utilization': '0.42',
    'anthropic-ratelimit-unified-5h-reset': '1700000000',
    'anthropic-ratelimit-unified-7d-utilization': '0.1',
    'anthropic-ratelimit-unified-7d-reset': '2026-02-01T00:00:00Z'
  });
  assert.equal(h.fiveHour.pct, 42);
  assert.equal(h.sevenDay.pct, 10);
  assert.ok(h.fiveHour.resetAt);
  assert.ok(h.sevenDay.resetAt);
});

test('normalizeOAuthUsageBody não inventa campos', () => {
  assert.equal(normalizeOAuthUsageBody(null), null);
  const n = normalizeOAuthUsageBody({
    five_hour: { utilization: 25, resets_at: '2026-01-28T15:00:00Z' },
    seven_day: { utilization: 40, resets_at: '2026-02-01T00:00:00Z' }
  });
  assert.equal(n.fiveHour.pct, 25);
  assert.equal(n.sevenDay.pct, 40);
});

test('normalizeSdkGetUsageResponse respeita rate_limits_available', () => {
  assert.equal(normalizeSdkGetUsageResponse({ rate_limits_available: false }), null);
  const n = normalizeSdkGetUsageResponse({
    rate_limits_available: true,
    subscription_type: 'max',
    rate_limits: {
      five_hour: { utilization: 10, resets_at: '2026-01-28T15:00:00Z' },
      seven_day: { utilization: 20, resets_at: '2026-02-01T00:00:00Z' }
    }
  });
  assert.equal(n.subscriptionType, 'max');
  assert.equal(n.fiveHour.pct, 10);
});

test('mergeSubscriptionWindows prefere valores mais recentes na ordem', () => {
  const a = { fiveHour: { pct: 10, resetAt: 1 } };
  const b = { fiveHour: { pct: 55, resetAt: 2 } };
  assert.equal(mergeSubscriptionWindows(a, b).fiveHour.pct, 55);
});

test('claudeAuthMode distingue API key e assinatura', () => {
  assert.equal(claudeAuthMode({ claude: { mode: 'api', apiKey: 'sk' } }), 'api_key');
  assert.equal(claudeAuthMode({ claude: { mode: 'oauth' } }), 'subscription');
  assert.equal(claudeAuthMode({ claude: { mode: 'oauth' } }, { ANTHROPIC_API_KEY: 'x' }), 'api_key');
});

test('refreshClaudeSubscriptionUsage usa cache', async () => {
  clearClaudeOAuthUsageCache();
  const db = {};
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        five_hour: { utilization: 30, resets_at: '2026-01-28T15:00:00Z' }
      })
    };
  };
  const cred = { accessToken: 'tok', source: 'test' };
  const opts = {
    fetchImpl,
    readToken: async () => cred
  };
  await refreshClaudeSubscriptionUsage(db, { claude: { mode: 'oauth' } }, opts);
  await refreshClaudeSubscriptionUsage(db, { claude: { mode: 'oauth' } }, opts);
  assert.equal(calls, 1);
  const lim = accountLimits(db, { claude: { mode: 'oauth' } });
  assert.equal(lim.claudeSubscription.available, true);
  assert.equal(lim.claudeSubscription.windows.fiveHour.pct, 30);
  clearClaudeOAuthUsageCache();
});

test('recordClaudeSubscriptionSnapshot persiste em providers.claude', () => {
  const db = {};
  recordClaudeSubscriptionSnapshot(db, {
    source: 'test',
    windows: { fiveHour: { pct: 5, resetAt: Date.now() + 3600_000 } }
  });
  const view = claudeSubscriptionView(db, { claude: { mode: 'oauth' } });
  assert.equal(view.available, true);
  assert.equal(view.windows.fiveHour.pct, 5);
});

test('uso por conta: cada conta guarda as próprias janelas e a vista marca a que está em uso', async () => {
  const { recordClaudeSubscriptionSnapshot: rec, claudeSubscriptionView: view } = await import('../lib/claude-subscription-usage.mjs');
  const db = {};
  rec(db, { source: 'oauth_endpoint', windows: { fiveHour: { pct: 100 } }, subscriptionType: 'pro' });
  rec(db, { source: 'oauth_endpoint', windows: { fiveHour: { pct: 12 } }, subscriptionType: 'team', account: 'teams' });
  const settings = { claude: { mode: 'subscription', defaultAccount: 'teams', accounts: [{ id: 'teams', label: 'Teams' }] } };
  // A principal só aparece se esta máquina tiver login (~/.claude/.credentials.json); no CI não tem.
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'ripper-home-'));
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', '.credentials.json'), '{}');
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = process.env.USERPROFILE = home;
  let v;
  try { v = view(db, settings, {}); } finally {
    for (const [k, val] of Object.entries(prev)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
  }
  assert.equal(v.activeAccount.id, 'teams');
  assert.equal(v.windows.fiveHour.pct, 12, 'barra principal = conta em uso');
  const byId = Object.fromEntries(v.accounts.map(a => [a.id, a]));
  assert.equal(byId.principal.windows.fiveHour.pct, 100);
  assert.equal(byId.teams.active, true);
  assert.equal(db.usage.providers.claude.windows.fiveHour.pct, 100, 'providers.claude continua sendo a principal (compat)');
});
