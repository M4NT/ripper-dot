/**
 * Limites de tamanho de corpo e tempo máximo de requisição HTTP (opt-in via env).
 * SSE em POST /api/chat usa orçamento separado (0 = sem limite).
 */

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function envNonNegativeInt(key, fallback, env = process.env) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function resolveHttpBudget(env = process.env) {
  return {
    maxBodyBytes: envNonNegativeInt('RIPPER_MAX_BODY_BYTES', 1_048_576, env),
    httpTimeoutMs: envNonNegativeInt('RIPPER_HTTP_TIMEOUT_MS', 120_000, env),
    sseTimeoutMs: envNonNegativeInt('RIPPER_SSE_TIMEOUT_MS', 0, env)
  };
}

/** @param {string} method @param {string} pathname */
export function isSseChatRequest(method, pathname) {
  return method === 'POST' && pathname === '/api/chat';
}

/** Limite de leitura do corpo para esta rota (upload de arquivo mantém teto maior). */
export function bodyByteLimit(method, pathname, { maxBodyBytes, maxFileBytes }) {
  if (!METHODS_WITH_BODY.has(method)) return null;
  if (method === 'POST' && pathname === '/api/files') return maxFileBytes;
  return maxBodyBytes;
}

/**
 * Rejeita com 413 quando Content-Length excede o limite (antes de ler o corpo).
 * @returns {boolean} true se a resposta já foi enviada
 */
export function rejectOversizeBody(req, res, method, pathname, limits, securityHeaders = {}) {
  const limit = bodyByteLimit(method, pathname, limits);
  if (limit == null) return false;
  const cl = req.headers['content-length'];
  if (cl === undefined || cl === '') return false;
  const n = Number(cl);
  if (!Number.isFinite(n) || n <= limit) return false;
  const payload = JSON.stringify({
    error: `Corpo da requisição excede o limite de ${limit} bytes.`,
    ...(req.requestId ? { requestId: req.requestId } : {})
  });
  res.writeHead(413, {
    ...securityHeaders,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(payload))
  });
  res.end(payload);
  return true;
}

/**
 * Aborta requisições ociosas ou presas. Retorna função para limpar o timer.
 * @returns {() => void}
 */
export function attachHttpTimeout(req, res, method, pathname, budget, securityHeaders = {}) {
  const sse = isSseChatRequest(method, pathname);
  const budgetMs = sse ? budget.sseTimeoutMs : budget.httpTimeoutMs;
  if (!(budgetMs > 0)) return () => {};

  let cleared = false;
  const clear = () => {
    if (cleared) return;
    cleared = true;
    clearTimeout(timer);
  };

  const timer = setTimeout(() => {
    if (cleared) return;
    clear();
    if (!res.headersSent) {
      const payload = JSON.stringify({
        error: 'Tempo esgotado aguardando a requisição.',
        ...(req.requestId ? { requestId: req.requestId } : {})
      });
      res.writeHead(408, {
        ...securityHeaders,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': String(Buffer.byteLength(payload))
      });
      res.end(payload);
    } else {
      req.destroy();
    }
  }, budgetMs);

  res.once('finish', clear);
  res.once('close', clear);
  return clear;
}
