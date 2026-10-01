import { randomUUID } from 'node:crypto';

export const BRAND_LOGO_MAX = 2 << 20;

export const EMPTY_BRAND = {
  displayName: '',
  logoUrl: '',
  accentColor: '',
  tagline: '',
  links: { twitter: '', linkedin: '', website: '' }
};

/** Caminho relativo em RIPPER_DATA/brand/* — sem traversal nem subpastas. */
export function isSafeBrandStoragePath(rel) {
  const s = String(rel || '').replace(/\\/g, '/');
  if (!s.startsWith('brand/')) return false;
  if (s.includes('..') || s.includes('\0')) return false;
  const base = s.slice('brand/'.length);
  if (!base || base.includes('/')) return false;
  return /^[\w.-]{1,120}$/.test(base);
}

function normalizeHttpUrl(raw, max = 300) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href.slice(0, max);
  } catch {
    return '';
  }
}

function normalizeAccentColor(c) {
  const s = String(c || '').trim();
  if (!s) return '';
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return '';
}

function normalizeLogoUrl(url) {
  const s = String(url || '').trim().slice(0, 500);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return normalizeHttpUrl(s, 500);
  if (isSafeBrandStoragePath(s)) return s;
  return '';
}

/** Normaliza settings.brand (defaults vazios = branding Ripper padrão). */
export function normalizeBrand(input) {
  const b = input && typeof input === 'object' ? input : {};
  const linksIn = b.links && typeof b.links === 'object' ? b.links : {};
  return {
    displayName: String(b.displayName || '').trim().slice(0, 80),
    logoUrl: normalizeLogoUrl(b.logoUrl),
    accentColor: normalizeAccentColor(b.accentColor),
    tagline: String(b.tagline || '').trim().slice(0, 160),
    links: {
      twitter: normalizeHttpUrl(linksIn.twitter),
      linkedin: normalizeHttpUrl(linksIn.linkedin),
      website: normalizeHttpUrl(linksIn.website)
    }
  };
}

const SIGNATURES = [
  { type: 'image/png', match: buf => buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 },
  { type: 'image/jpeg', match: buf => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff },
  { type: 'image/gif', match: buf => buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') },
  { type: 'image/webp', match: buf => buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' }
];

export function detectImageType(buf) {
  if (!buf?.length) return null;
  for (const s of SIGNATURES) if (s.match(buf)) return s.type;
  return null;
}

export function extForImageType(type) {
  return ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' })[type] || '';
}

function parseMultipartFile(body, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delim);
  if (start < 0) throw new Error('multipart inválido.');
  start += delim.length;
  if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
  const next = body.indexOf(delim, start);
  const part = next < 0 ? body.subarray(start) : body.subarray(start, next - 2);
  const headerEnd = part.indexOf('\r\n\r\n');
  if (headerEnd < 0) throw new Error('multipart inválido.');
  const headers = part.subarray(0, headerEnd).toString('utf8');
  const buf = part.subarray(headerEnd + 4);
  const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
  const nameMatch = /filename="([^"]+)"/i.exec(headers) || /filename=([^\r\n;]+)/i.exec(headers);
  const type = (typeMatch?.[1] || 'application/octet-stream').trim().toLowerCase();
  const filename = (nameMatch?.[1] || 'logo').trim();
  return { buf, type, filename };
}

/**
 * Lê upload de logo (multipart campo file ou corpo raw image/*).
 * @param {import('node:http').IncomingMessage} req
 * @param {(req: import('node:http').IncomingMessage, limit: number) => Promise<Buffer>} readRaw
 */
export async function readBrandLogoUpload(req, readRaw) {
  const ct = String(req.headers['content-type'] || '');
  const limit = BRAND_LOGO_MAX + (1 << 20);
  if (ct.includes('multipart/form-data')) {
    const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(ct);
    if (!m) throw new Error('multipart inválido.');
    const body = await readRaw(req, limit);
    return parseMultipartFile(body, m[1] || m[2]);
  }
  const buf = await readRaw(req, BRAND_LOGO_MAX);
  const type = ct.split(';')[0].trim().toLowerCase();
  return { buf, type, filename: 'logo' };
}

export function newBrandLogoFilename(type) {
  return `logo-${randomUUID().slice(0, 8)}${extForImageType(type)}`;
}
