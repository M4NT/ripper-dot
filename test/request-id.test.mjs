import test from 'node:test';
import assert from 'node:assert/strict';
import { readOrCreateRequestId, attachRequestId } from '../lib/request-id.mjs';

test('readOrCreateRequestId ecoa header seguro do cliente', () => {
  const req = { headers: { 'x-request-id': 'abc' } };
  assert.equal(readOrCreateRequestId(req), 'abc');
});

test('readOrCreateRequestId gera UUID se header ausente', () => {
  const id = readOrCreateRequestId({ headers: {} });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('readOrCreateRequestId ignora header com caracteres inválidos', () => {
  const id = readOrCreateRequestId({ headers: { 'x-request-id': 'bad id!' } });
  assert.match(id, /^[0-9a-f-]{36}$/i);
});

test('attachRequestId define req e header de resposta', () => {
  const req = { headers: { 'x-request-id': 'trace-1' } };
  const headers = {};
  const res = { setHeader(k, v) { headers[k] = v; } };
  assert.equal(attachRequestId(req, res), 'trace-1');
  assert.equal(req.requestId, 'trace-1');
  assert.equal(headers['X-Request-Id'], 'trace-1');
});
