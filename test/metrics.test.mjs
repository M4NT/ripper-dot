import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMetricRoute,
  recordHttpRequest,
  recordChatTurn,
  formatPrometheusExposition,
  resetMetricsForTests,
  getHttpInFlight,
  incrementHttpInFlight,
  metricsAccessAllowed,
  prometheusContentType
} from '../lib/metrics.mjs';

test('normalizeMetricRoute reduz ids e mantém rotas literais', () => {
  assert.equal(normalizeMetricRoute('/metrics'), '/metrics');
  assert.equal(normalizeMetricRoute('/api/health'), '/api/health');
  assert.equal(normalizeMetricRoute('/api/chats/abc123xyz/chat'), '/api/chats/:id/chat');
  assert.equal(
    normalizeMetricRoute('/api/hooks/' + 'a'.repeat(48)),
    '/api/hooks/:token'
  );
  assert.equal(normalizeMetricRoute('/assets/main-abc123.js'), '/assets/:file');
  assert.equal(normalizeMetricRoute('/api/mcp/connectors/my-plugin'), '/api/mcp/connectors/:id');
});

test('contadores HTTP e chat no formato Prometheus', () => {
  resetMetricsForTests();
  recordHttpRequest('GET', '/api/health', 200);
  recordHttpRequest('GET', '/api/health', 200);
  recordHttpRequest('POST', '/api/chat', 500);
  recordChatTurn('ok');
  recordChatTurn('error');
  incrementHttpInFlight(1);
  assert.equal(getHttpInFlight(), 1);
  const text = formatPrometheusExposition();
  assert.match(text, /# TYPE ripper_http_requests_total counter/);
  assert.match(text, /ripper_http_requests_total\{method="GET",route="\/api\/health",status="200"\} 2/);
  assert.match(text, /ripper_chat_turns_total\{status="ok"\} 1/);
  assert.match(text, /ripper_http_in_flight 1/);
  assert.match(text, /# TYPE ripper_process_uptime_seconds gauge/);
  assert.match(prometheusContentType(), /text\/plain; version=0\.0\.4/);
  resetMetricsForTests();
});

test('metricsAccessAllowed respeita RIPPER_METRICS_PUBLIC', () => {
  const prev = process.env.RIPPER_METRICS_PUBLIC;
  const req = { headers: {} };
  process.env.RIPPER_METRICS_PUBLIC = '1';
  assert.equal(metricsAccessAllowed(req, 'secret'), true);
  delete process.env.RIPPER_METRICS_PUBLIC;
  assert.equal(metricsAccessAllowed(req, ''), true);
  assert.equal(metricsAccessAllowed(req, 'secret'), false);
  assert.equal(metricsAccessAllowed({ headers: { authorization: 'Bearer secret' } }, 'secret'), true);
  if (prev === undefined) delete process.env.RIPPER_METRICS_PUBLIC;
  else process.env.RIPPER_METRICS_PUBLIC = prev;
});
