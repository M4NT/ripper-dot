import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import qrcode from 'qrcode-generator';

const sha = t => createHash('sha256').update(String(t)).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

/** Convite de pareamento: um por vez (gerar outro invalida o anterior), uso único, expira. */
export function pairingInvite({ ttlMs = 10 * 60e3 } = {}) {
  let cur = null;
  return {
    create() { const t = newToken(); cur = { hash: sha(t), exp: Date.now() + ttlMs }; return { token: t, expiresAt: cur.exp }; },
    consume(t) {
      const ok = !!t && !!cur && cur.exp > Date.now() && cur.hash === sha(t);
      if (ok) cur = null;
      return ok;
    },
    ttlMs
  };
}

/** Aparelhos pareados: guarda só o hash do token (sobrevive a reinício via db). Sessão separada da senha. */
export function deviceStore(getList, save) {
  return {
    create(name) {
      const token = newToken();
      const d = { id: randomUUID(), name: String(name || 'Aparelho').slice(0, 80), tokenHash: sha(token), createdAt: Date.now(), lastSeenAt: Date.now() };
      getList().push(d); save();
      return { token, device: d };
    },
    valid(token) {
      if (!token) return null;
      const h = sha(token), d = getList().find(x => x.tokenHash === h);
      // ponytail: lastSeenAt só na memória até o próximo save do db; não vale um write por requisição.
      if (d) d.lastSeenAt = Date.now();
      return d || null;
    },
    revoke(id) { const l = getList(), i = l.findIndex(x => x.id === id); if (i < 0) return false; l.splice(i, 1); save(); return true; },
    list: () => getList().map(({ tokenHash, ...d }) => d)
  };
}
export const deviceCookie = req => /(?:^|;\s*)ripper_device=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';

/** IPv4 da rede local (Wi-Fi/cabo), evitando adaptadores virtuais (VirtualBox, Hyper-V/WSL, Docker, VPN). */
const VIRTUAL = /virtual|vbox|vmware|vethernet|hyper-v|wsl|docker|br-|veth|tailscale|zerotier|utun|tun|tap/i;
export function lanAddress(ifs = networkInterfaces()) {
  const all = Object.entries(ifs).flatMap(([name, list]) => (list || []).map(a => ({ ...a, name })))
    .filter(a => (a.family === 'IPv4' || a.family === 4) && !a.internal);
  const priv = a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
  // ponytail: escolhe por nome do adaptador; se errar, HOST=<ip> continua valendo.
  const wifi = a => /wi-?fi|wlan|wlp|wireless|^en0$/i.test(a.name);
  const real = a => !VIRTUAL.test(a.name) && !a.address.startsWith('192.168.56.'); // 192.168.56.x = VirtualBox
  return (all.find(a => priv(a) && wifi(a)) || all.find(a => priv(a) && real(a)) || all.find(priv) || all[0])?.address || null;
}

export function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
}

/** Nome legível do aparelho a partir do User-Agent. */
export function deviceName(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Aparelho';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}
