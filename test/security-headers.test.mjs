import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCorsAllowlist,
  securityHeaderFields,
  classifyRequestOrigin,
  corsHeaderFields,
  mutatingOriginError,
  handleApiCorsPreflight
} from '../lib/security-headers.mjs';
import { EventEmitter } from 'node:events';

function mockReq({ method = 'GET', origin, host = '127.0.0.1:3000' } = {}) {
  return {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(host ? { host } : {})
    }
  };
}

function mockRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    res._headers = headers;
    res.headersSent = true;
  };
  res.end = body => {
    res.body = body;
    res.emit('finish');
  };
  return res;
}

test('parseCorsAllowlist: vazio e lista com espaços', () => {
  assert.equal(parseCorsAllowlist('').size, 0);
  assert.equal(parseCorsAllowlist(undefined).size, 0);
  const s = parseCorsAllowlist('https://a.test, https://b.test ');
  assert.deepEqual([...s], ['https://a.test', 'https://b.test']);
});

test('securityHeaderFields inclui nosniff, referrer e frame deny', () => {
  const h = securityHeaderFields();
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['referrer-policy'], 'no-referrer');
  assert.equal(h['x-frame-options'], 'DENY');
  const csp = h['content-security-policy'] || '';
  assert.ok(csp.includes("frame-ancestors 'none'"));
  const img = /img-src[^;]*/.exec(csp)?.[0] || '';
  assert.match(img, /img-src 'self' data: blob:/);
  assert.equal(img.includes('https:'), false, 'img-src não libera https de terceiros');
});

test('classifyRequestOrigin: sem Origin, same-host e allowlist', () => {
  const list = parseCorsAllowlist('https://app.example.com');
  assert.equal(classifyRequestOrigin(mockReq(), list).kind, 'none');
  assert.equal(
    classifyRequestOrigin(mockReq({ origin: 'http://127.0.0.1:3000' }), list).kind,
    'same-host'
  );
  assert.equal(
    classifyRequestOrigin(mockReq({ origin: 'https://app.example.com' }), list).kind,
    'allowlisted'
  );
  assert.equal(
    classifyRequestOrigin(mockReq({ origin: 'https://evil.example' }), list).kind,
    'denied'
  );
});

test('corsHeaderFields só reflete origem allowlisted', () => {
  const list = parseCorsAllowlist('https://app.example.com');
  assert.deepEqual(corsHeaderFields(mockReq({ origin: 'https://evil.example' }), list), {});
  assert.equal(
    corsHeaderFields(mockReq({ origin: 'https://app.example.com' }), list)['access-control-allow-origin'],
    'https://app.example.com'
  );
});

test('mutatingOriginError nega origem desconhecida com allowlist vazia', () => {
  const list = parseCorsAllowlist('');
  assert.equal(
    mutatingOriginError(mockReq({ method: 'POST', origin: 'https://other.test' }), list),
    'Origem não permitida.'
  );
  assert.equal(mutatingOriginError(mockReq({ method: 'POST' }), list), null);
});

test('mutatingOriginError permite origem na allowlist', () => {
  const list = parseCorsAllowlist('https://app.example.com');
  assert.equal(
    mutatingOriginError(mockReq({ method: 'PUT', origin: 'https://app.example.com' }), list),
    null
  );
});

test('handleApiCorsPreflight: 204 allowlisted, 403 negado', () => {
  const list = parseCorsAllowlist('https://app.example.com');
  const okReq = mockReq({ method: 'OPTIONS', origin: 'https://app.example.com' });
  const okRes = mockRes();
  assert.equal(handleApiCorsPreflight(okReq, okRes, list), true);
  assert.equal(okRes.statusCode, 204);
  assert.equal(okRes._headers['access-control-allow-origin'], 'https://app.example.com');

  const badReq = mockReq({ method: 'OPTIONS', origin: 'https://evil.example' });
  const badRes = mockRes();
  handleApiCorsPreflight(badReq, badRes, list);
  assert.equal(badRes.statusCode, 403);
});
