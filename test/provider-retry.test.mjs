import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryableProviderError,
  providerRetryDelayMs,
  normalizeProviderRetry,
  sleepMs
} from '../lib/provider-retry.mjs';

test('isRetryableProviderError reconhece 429 sem inventar reset', () => {
  assert.equal(isRetryableProviderError(new Error('HTTP 429 too many requests')), true);
  assert.equal(isRetryableProviderError(new Error('falha genérica')), false);
});

test('providerRetryDelayMs usa retry-after quando presente', () => {
  const err = new Error('rate_limit retry after 42');
  const ms = providerRetryDelayMs(err, 1, { baseDelayMs: 1000, maxDelayMs: 60_000 });
  assert.ok(ms >= 40_000 && ms <= 43_000);
});

test('providerRetryDelayMs faz backoff exponencial sem reset no erro', () => {
  const err = new Error('429 overloaded');
  assert.equal(providerRetryDelayMs(err, 1, { baseDelayMs: 1000, maxDelayMs: 60_000 }), 1000);
  assert.equal(providerRetryDelayMs(err, 2, { baseDelayMs: 1000, maxDelayMs: 60_000 }), 2000);
});

test('normalizeProviderRetry limita tentativas', () => {
  assert.deepEqual(normalizeProviderRetry({ providerRetry: { maxAttempts: 99, baseDelayMs: 1, maxDelayMs: 500 } }), {
    maxAttempts: 6,
    baseDelayMs: 200,
    maxDelayMs: 500
  });
});

test('sleepMs respeita abort', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => sleepMs(50, ac.signal), /aborted/);
});
