import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import {
  normalizeBrand,
  isSafeBrandStoragePath,
  detectImageType,
  BRAND_LOGO_MAX
} from '../lib/brand.mjs';
import { applySettingsPatch } from '../lib/settings-patch.mjs';
import { freePort } from './helpers/free-port.mjs';

test('normalizeBrand defaults vazios e sanitiza campos', () => {
  const b = normalizeBrand({
    displayName: '  Acme  ',
    logoUrl: 'brand/logo-abc.png',
    accentColor: '#ABC',
    tagline: 'Olá',
    links: { website: 'https://acme.com', twitter: 'javascript:alert(1)', linkedin: '' }
  });
  assert.equal(b.displayName, 'Acme');
  assert.equal(b.logoUrl, 'brand/logo-abc.png');
  assert.equal(b.accentColor, '#abc');
  assert.equal(b.tagline, 'Olá');
  assert.equal(b.links.website, 'https://acme.com/');
  assert.equal(b.links.twitter, '');
});

test('normalizeBrand rejeita logoUrl com path traversal', () => {
  assert.equal(normalizeBrand({ logoUrl: 'brand/../etc/passwd' }).logoUrl, '');
  assert.equal(normalizeBrand({ logoUrl: 'https://cdn.example/logo.png' }).logoUrl, 'https://cdn.example/logo.png');
});

test('isSafeBrandStoragePath', () => {
  assert.equal(isSafeBrandStoragePath('brand/logo-1.png'), true);
  assert.equal(isSafeBrandStoragePath('brand/sub/x.png'), false);
  assert.equal(isSafeBrandStoragePath('uploads/x.png'), false);
  assert.equal(isSafeBrandStoragePath('brand/../x.png'), false);
});

test('applySettingsPatch normaliza brand', () => {
  const s = {
    defaultModel: 'auto', claude: {}, computer: {},
    ui: { mode: 'enterprise' }, enterprise: { enabled: true },
    brand: { displayName: '', logoUrl: '', accentColor: '', tagline: '', links: {} }
  };
  applySettingsPatch(s, { brand: { displayName: 'Ripper Co', accentColor: '#ff00zz', links: { website: 'not-a-url' } } });
  assert.equal(s.brand.displayName, 'Ripper Co');
  assert.equal(s.brand.accentColor, '');
  assert.equal(s.brand.links.website, '');
});

test('detectImageType reconhece PNG mínimo', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectImageType(png), 'image/png');
});

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));


async function withServer(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-brand-'));
  const port = await freePort();
  const env = { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TOKEN: 'brand-test-token' };
  const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer brand-test-token' };
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/api/health', { headers: auth });
        if (r.ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    await fn(base, auth, dataDir);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

async function enableEnterprise(base, auth) {
  const r = await fetch(base + '/api/settings', {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ ui: { mode: 'enterprise' }, enterprise: { enabled: true } })
  });
  assert.equal(r.status, 200);
}

test('POST /api/brand/logo salva em brand/ e GET file serve imagem', async () => {
  await withServer(async (base, auth, dataDir) => {
    await enableEnterprise(base, auth);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const boundary = '----ripperbrand';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const up = await fetch(base + '/api/brand/logo', {
      method: 'POST',
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body
    });
    assert.equal(up.status, 200);
    const { logoUrl } = await up.json();
    assert.match(logoUrl, /^brand\/logo-/);
    const getBad = await fetch(base + '/api/brand/file/..%2F..%2Fx.png', { headers: auth });
    assert.equal(getBad.status, 404);
    const name = logoUrl.slice('brand/'.length);
    const get = await fetch(base + `/api/brand/file/${name}`, { headers: auth });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('content-type'), 'image/png');
  });
});

test('POST /api/brand/logo exige modo enterprise', async () => {
  await withServer(async (base, auth) => {
    const r = await fetch(base + '/api/brand/logo', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'image/png' },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    });
    assert.equal(r.status, 403);
  });
});

test('POST /api/brand/logo rejeita arquivo grande', async () => {
  await withServer(async (base, auth) => {
    await enableEnterprise(base, auth);
    const big = Buffer.alloc(BRAND_LOGO_MAX + 1, 0x89);
    const r = await fetch(base + '/api/brand/logo', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'image/png' },
      body: big
    });
    assert.ok(r.status === 413 || r.status === 400);
  });
});
