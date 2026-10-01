import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
const MAX_LEN = 128;
/** IDs de cliente: alfanumérico, hífen e underscore (sem segredos longos arbitrários). */
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;

export function readOrCreateRequestId(req) {
  const raw = req.headers[REQUEST_ID_HEADER];
  const fromClient = Array.isArray(raw) ? raw[0] : raw;
  if (typeof fromClient === 'string') {
    const trimmed = fromClient.trim().slice(0, MAX_LEN);
    if (SAFE.test(trimmed)) return trimmed;
  }
  return randomUUID();
}

/** Gera ou ecoa o id, grava em `req.requestId` e define o header de resposta. */
export function attachRequestId(req, res) {
  const requestId = readOrCreateRequestId(req);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  return requestId;
}
