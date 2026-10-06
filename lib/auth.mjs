import { timingSafeEqual, scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Valida Bearer ou cookie ripper_token contra o segredo configurado (vazio = sem auth). */
export function authed(req, token) {
  if (!token) return true;
  const got = (req.headers.authorization || '').replace(/^Bearer /, '') || /(?:^|;\s*)ripper_token=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
  const a = Buffer.from(decodeURIComponent(got)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- senha única (um Ripper por pessoa) ---------- */
const scryptAsync = promisify(scrypt);

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = await scryptAsync(String(pw), salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scryptAsync(String(pw), Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(got, want);
}
export const passwordProblem = pw => typeof pw !== 'string' || pw.length < 8 ? 'A senha precisa ter pelo menos 8 caracteres.' : pw.length > 200 ? 'Senha longa demais.' : null;

/** data/auth.json com o hash. Relido quando muda (o script do terminal troca a senha com o servidor rodando). */
export function passwordFile(path) {
  let cache = { mtime: -1, hash: null };
  const get = () => {
    let st; try { st = statSync(path); } catch { cache = { mtime: -1, hash: null }; return null; }
    if (st.mtimeMs !== cache.mtime) {
      try { cache = { mtime: st.mtimeMs, hash: JSON.parse(readFileSync(path, 'utf8')).hash || null }; } catch { cache = { mtime: st.mtimeMs, hash: null }; }
    }
    return cache.hash;
  };
  const set = hash => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify({ hash, updatedAt: Date.now() }), { mode: 0o600 }); };
  return { get, set };
}

/** Sessões em memória, presas ao hash da senha: trocar a senha derruba todas. */
// ponytail: sessões só em memória; reiniciar o servidor pede a senha de novo. Persistir se incomodar.
export function sessionStore({ ttlMs = 30 * 864e5 } = {}) {
  const map = new Map();
  return {
    create(hash) { const t = randomBytes(32).toString('base64url'); map.set(t, { hash, exp: Date.now() + ttlMs }); return t; },
    valid(t, hash) { const s = t && map.get(t); if (!s) return false; if (s.exp < Date.now() || s.hash !== hash) { map.delete(t); return false; } return true; },
    drop(t) { map.delete(t); },
    ttlMs
  };
}
export const sessionCookie = req => /(?:^|;\s*)ripper_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';

/** Tentativas de login: 5 erros seguidos bloqueiam por 15 min (por endereço). */
// ponytail: em memória e por IP; atrás de um túnel todos viram o mesmo IP, o que só deixa mais rígido.
export function loginLimiter({ max = 5, lockMs = 15 * 60e3 } = {}) {
  const map = new Map();
  return {
    retryAfter(key) { const s = map.get(key); return s?.until > Date.now() ? Math.ceil((s.until - Date.now()) / 1000) : 0; },
    fail(key) { const s = map.get(key) || { n: 0, until: 0 }; s.n++; if (s.n >= max) { s.n = 0; s.until = Date.now() + lockMs; } map.set(key, s); },
    ok(key) { map.delete(key); }
  };
}
