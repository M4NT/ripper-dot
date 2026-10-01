import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logger,
  configureLogger,
  isJsonLogging,
  runWithRequestContext,
  shouldLogHttpRoute
} from '../lib/logger.mjs';
import { attachRequestId } from '../lib/request-id.mjs';

function withCapturedConsole(fn) {
  const logs = [];
  const err = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try {
    return fn({ logs, err });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

test('configureLogger: JSON via settings.logging.json', () => {
  const prev = process.env.RIPPER_LOG_JSON;
  delete process.env.RIPPER_LOG_JSON;
  configureLogger({ settings: { logging: { json: true } } });
  assert.equal(isJsonLogging(), true);
  configureLogger({ settings: { logging: { json: false } } });
  assert.equal(isJsonLogging(), false);
  if (prev != null) process.env.RIPPER_LOG_JSON = prev;
});

test('RIPPER_LOG_JSON força modo JSON', () => {
  process.env.RIPPER_LOG_JSON = '1';
  configureLogger({ settings: { logging: { json: false } } });
  assert.equal(isJsonLogging(), true);
  delete process.env.RIPPER_LOG_JSON;
  configureLogger({ settings: {} });
});

test('logger JSON inclui ts, level, msg e requestId (attachRequestId)', () => {
  process.env.RIPPER_LOG_JSON = '1';
  configureLogger({ settings: {} });
  withCapturedConsole(({ logs }) => {
    const req = { headers: { 'x-request-id': 'req-abc' } };
    const res = { setHeader() {} };
    attachRequestId(req, res);
    runWithRequestContext(req, '/api/health', () => {
      logger.info('http.request.start', { method: 'GET' });
    });
    assert.equal(logs.length, 1);
    const line = JSON.parse(logs[0]);
    assert.equal(line.level, 'info');
    assert.equal(line.msg, 'http.request.start');
    assert.equal(line.requestId, 'req-abc');
    assert.equal(line.route, '/api/health');
    assert.equal(line.method, 'GET');
    assert.ok(line.ts);
  });
  delete process.env.RIPPER_LOG_JSON;
  configureLogger({ settings: {} });
});

test('logger redige Authorization e tokens na mensagem', () => {
  process.env.RIPPER_LOG_JSON = '1';
  configureLogger({ settings: {} });
  withCapturedConsole(({ logs }) => {
    logger.info('falhou Bearer supersecret-token-abcdefghijklmnopqrstuvwxyz');
    const line = JSON.parse(logs[0]);
    assert.match(line.msg, /Bearer ••••/);
    assert.doesNotMatch(line.msg, /supersecret-token/);
  });
  delete process.env.RIPPER_LOG_JSON;
  configureLogger({ settings: {} });
});

test('logger redige campos sensíveis em extra', () => {
  process.env.RIPPER_LOG_JSON = '1';
  configureLogger({ settings: {} });
  withCapturedConsole(({ logs }) => {
    logger.info('test', {
      headers: { Authorization: 'Bearer xyz', Accept: 'json' },
      sealed: 'blob-data',
      user: 'a@example.com'
    });
    const line = JSON.parse(logs[0]);
    assert.equal(line.headers.Authorization, '••••');
    assert.equal(line.headers.Accept, 'json');
    assert.equal(line.sealed, '••••');
    assert.equal(line.user, '[email]');
  });
  delete process.env.RIPPER_LOG_JSON;
  configureLogger({ settings: {} });
});

test('shouldLogHttpRoute só API', () => {
  assert.equal(shouldLogHttpRoute('/api/health'), true);
  assert.equal(shouldLogHttpRoute('/assets/app.js'), false);
});
