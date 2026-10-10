
const PROM_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Segmentos literais de rota que nunca viram :id */
const LITERAL_SEGMENTS = new Set([
  'api', 'health', 'diagnostics', 'catalog', 'state', 'settings', 'usage', 'limits', 'context', 'compact',
  'data', 'backup', 'backups', 'restore', 'mcp', 'verify', 'connectors', 'tools', 'session', 'oauth',
  'refresh', 'start', 'status', 'callback', 'audit', 'artifacts', 'download', 'skills', 'catalog',
  'julia', 'computer', 'cleanup', 'docker', 'image', 'agents', 'messages', 'approvals', 'projects',
  'agent-templates', 'routines', 'chats', 'chat', 'files', 'hooks', 'memories', 'vnc', 'screen',
  'cancel', 'export', 'import', 'inbox', 'plugins', 'oauth', 'usage', 'stream', 'webhook', 'events', 'ui-actions', 'ui-parts'
]);

const DYNAMIC_PARENT = new Set([
  'agents', 'chats', 'projects', 'skills', 'artifacts', 'memories', 'routines', 'approvals',
  'agent-templates', 'connectors', 'files'
]);

const httpRequests = new Map();
const chatTurns = new Map();
let httpInFlight = 0;
const processStartMs = Date.now();

function labelKey(parts) {
  return parts.map(([k, v]) => `${k}=${JSON.stringify(String(v))}`).join(',');
}

/**
 * Normaliza path para baixa cardinalidade (ids → :id, hooks → :token).
 * @param {string} pathname
 */
const TOP_LEVEL_ROUTES = new Set(['/metrics', '/index.html', '/favicon.svg']);

export function normalizeMetricRoute(pathname) {
  let p = String(pathname || '/').split('?')[0];
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);

  if (TOP_LEVEL_ROUTES.has(p) || p === '/') return p === '/' ? '/' : p;

  p = p.replace(/^\/api\/hooks\/[a-f0-9]{48}$/i, '/api/hooks/:token');

  if (p.startsWith('/assets/')) return '/assets/:file';

  const segs = p.split('/').filter(Boolean);
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const prev = segs[i - 1];
    if (seg === 'oauth' && prev === 'status') {
      out.push(':id');
      continue;
    }
    if (prev && DYNAMIC_PARENT.has(prev) && !LITERAL_SEGMENTS.has(seg)) {
      out.push(':id');
      continue;
    }
    if (prev === 'mcp' && seg === 'connectors' && segs[i + 1] && !LITERAL_SEGMENTS.has(segs[i + 1])) {
      out.push('connectors');
      out.push(':id');
      i++;
      continue;
    }
    if (!LITERAL_SEGMENTS.has(seg) && /^[\w-]{6,64}$/.test(seg)) {
      out.push(':id');
      continue;
    }
    out.push(seg);
  }
  return '/' + out.join('/');
}

export function metricsPublicEnabled() {
  return process.env.RIPPER_METRICS_PUBLIC === '1';
}

/** Mesma regra do resto do app: precisa estar logado (senha, celular pareado ou RIPPER_TOKEN), exceto scrape público opt-in. */
export function metricsAccessAllowed(signedIn) {
  return metricsPublicEnabled() || signedIn === true;
}

export function incrementHttpInFlight(delta) {
  httpInFlight += delta;
  if (httpInFlight < 0) httpInFlight = 0;
}

export function recordHttpRequest(method, route, status) {
  const m = String(method || 'GET').toUpperCase();
  const r = normalizeMetricRoute(route);
  const s = String(status ?? 0);
  const key = labelKey([['method', m], ['route', r], ['status', s]]);
  httpRequests.set(key, (httpRequests.get(key) || 0) + 1);
}

/** @param {'ok'|'error'|'interrupted'} status */
export function recordChatTurn(status) {
  const st = status === 'error' || status === 'interrupted' ? status : 'ok';
  const key = labelKey([['status', st]]);
  chatTurns.set(key, (chatTurns.get(key) || 0) + 1);
}

export function getHttpInFlight() {
  return httpInFlight;
}

export function prometheusContentType() {
  return PROM_CONTENT_TYPE;
}

export function formatPrometheusExposition() {
  const lines = [];
  lines.push('# HELP ripper_http_requests_total Total de requisições HTTP atendidas pelo Ripper.');
  lines.push('# TYPE ripper_http_requests_total counter');
  for (const [key, value] of [...httpRequests.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`ripper_http_requests_total{${key}} ${value}`);
  }

  lines.push('# HELP ripper_chat_turns_total Turnos de chat do agente (provedor).');
  lines.push('# TYPE ripper_chat_turns_total counter');
  for (const [key, value] of [...chatTurns.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`ripper_chat_turns_total{${key}} ${value}`);
  }

  lines.push('# HELP ripper_http_in_flight Requisições HTTP em andamento.');
  lines.push('# TYPE ripper_http_in_flight gauge');
  lines.push(`ripper_http_in_flight ${httpInFlight}`);

  const uptime = (Date.now() - processStartMs) / 1000;
  lines.push('# HELP ripper_process_uptime_seconds Tempo desde o início do processo Node.');
  lines.push('# TYPE ripper_process_uptime_seconds gauge');
  lines.push(`ripper_process_uptime_seconds ${uptime.toFixed(3)}`);

  return lines.join('\n') + '\n';
}

/** Só para testes unitários. */
export function resetMetricsForTests() {
  httpRequests.clear();
  chatTurns.clear();
  httpInFlight = 0;
}
