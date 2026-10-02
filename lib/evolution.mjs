// WhatsApp sem API oficial (QR) via Evolution API, gerenciada pelo Ripper no Docker.
//
// Segurança (a sessão do QR dá controle total do número):
// - Evolution + Postgres só na rede interna ripper-net; a API publica apenas em 127.0.0.1.
// - Segredos (chave da Evolution, senha do banco, token do webhook) ficam em data/evolution.json,
//   fora das configurações: nunca passam pela API nem pela interface.
// - Só responde números da lista; ignora grupos, status e as próprias mensagens (evita loop).
// - Nunca inicia conversa; limite por contato e por hora; atraso "humano" antes de enviar.
// - O turno do agente roda sem computador/navegador/plugins (ver channelSafeAgent).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dataUrl } from './store.mjs';

export const EVOLUTION_IMAGE = 'evoapicloud/evolution-api:v2.3.7';
const PG_IMAGE = 'postgres:16-alpine';
const NETWORK = 'ripper-net';
const API_NAME = 'ripper-evolution', DB_NAME = 'ripper-evolution-db';
const PORT = 18080; // só em 127.0.0.1
const BASE = process.env.EVOLUTION_URL || `http://127.0.0.1:${PORT}`; // override só para testes
export const INSTANCE = 'ripper';

function docker(args, timeout = 120_000) {
  return new Promise(resolve => {
    const p = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    p.on('close', code => { clearTimeout(t); resolve({ code, out: out.trim(), err: err.trim() }); });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out: '', err: e.message }); });
  });
}

/** Segredos locais, gerados uma vez. Arquivo fora de settings: não entra em /api/state nem em backup JSON. */
export function evolutionSecrets() {
  const file = fileURLToPath(dataUrl('evolution.json'));
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const s = { apiKey: randomBytes(24).toString('hex'), dbPassword: randomBytes(18).toString('hex'), hookToken: randomBytes(24).toString('hex') };
  writeFileSync(file, JSON.stringify(s), { mode: 0o600 });
  return s;
}

const running = async name => (await docker(['inspect', '-f', '{{.State.Running}}', name], 10_000)).out === 'true';

/** Sobe Postgres + Evolution (idempotente). ripperPort: porta do Ripper para o webhook interno. */
export async function ensureEvolution(ripperPort) {
  const s = evolutionSecrets();
  if ((await docker(['network', 'inspect', NETWORK], 10_000)).code !== 0) await docker(['network', 'create', NETWORK]);
  if (!(await running(DB_NAME))) {
    await docker(['rm', '-f', DB_NAME], 20_000);
    const r = await docker(['run', '-d', '--name', DB_NAME, '--network', NETWORK, '--network-alias', 'evolution-db', '--restart', 'unless-stopped',
      '-e', `POSTGRES_PASSWORD=${s.dbPassword}`, '-e', 'POSTGRES_DB=evolution',
      '-v', 'ripper-evolution-pg:/var/lib/postgresql/data', PG_IMAGE], 600_000);
    if (r.code !== 0) throw new Error(`Postgres da Evolution não subiu: ${r.err.slice(0, 200)}`);
  }
  if (!(await running(API_NAME))) {
    await docker(['rm', '-f', API_NAME], 20_000);
    const r = await docker(['run', '-d', '--name', API_NAME, '--network', NETWORK, '--restart', 'unless-stopped',
      '-p', `127.0.0.1:${PORT}:8080`,
      // Docker Desktop: host.docker.internal alcança o Ripper em 127.0.0.1. ponytail: no Linux com HOST=127.0.0.1
      // o host-gateway não chega no loopback; rodar o Ripper com HOST=0.0.0.0 atrás de firewall se precisar.
      '--add-host', 'host.docker.internal:host-gateway',
      '-e', `AUTHENTICATION_API_KEY=${s.apiKey}`,
      '-e', 'DATABASE_PROVIDER=postgresql',
      '-e', `DATABASE_CONNECTION_URI=postgresql://postgres:${s.dbPassword}@evolution-db:5432/evolution?schema=public`,
      '-e', 'DATABASE_SAVE_DATA_INSTANCE=true', '-e', 'DATABASE_SAVE_NEW_MESSAGE=false', '-e', 'DATABASE_SAVE_MESSAGE_UPDATE=false',
      '-e', 'DATABASE_SAVE_DATA_CONTACTS=false', '-e', 'DATABASE_SAVE_DATA_CHATS=false', // não acumula conversas de terceiros
      '-e', 'CACHE_REDIS_ENABLED=false', '-e', 'CACHE_LOCAL_ENABLED=true',
      '-e', `SERVER_URL=${BASE}`, '-e', 'CONFIG_SESSION_PHONE_CLIENT=Ripper', '-e', 'LOG_LEVEL=ERROR',
      '-v', 'ripper-evolution-store:/evolution/instances', EVOLUTION_IMAGE], 900_000);
    if (r.code !== 0) throw new Error(`Evolution não subiu: ${r.err.slice(0, 200)}`);
  }
  for (let i = 0; i < 90; i++) { // migrações do banco na primeira subida
    try { if ((await fetch(BASE + '/', { signal: AbortSignal.timeout(2000) })).ok) return { ripperPort }; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Evolution não respondeu a tempo.');
}

async function evo(path, { method = 'GET', body } = {}) {
  const r = await fetch(BASE + path, {
    method, headers: { apikey: evolutionSecrets().apiKey, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Evolution ${r.status}: ${JSON.stringify(j).slice(0, 200)}`), { status: r.status });
  return j;
}

/** Cria a instância (se preciso) e devolve o QR para escanear. */
export async function connectInstance(ripperPort) {
  await ensureEvolution(ripperPort);
  const { hookToken } = evolutionSecrets();
  const list = await evo(`/instance/fetchInstances?instanceName=${INSTANCE}`).catch(() => []);
  if (!(Array.isArray(list) && list.length)) {
    await evo('/instance/create', { method: 'POST', body: {
      instanceName: INSTANCE, integration: 'WHATSAPP-BAILEYS', qrcode: true,
      groupsIgnore: true, rejectCall: true, msgCall: 'Este número não atende ligações.', readMessages: false, syncFullHistory: false,
      webhook: { enabled: true, byEvents: false, base64: false, url: `http://host.docker.internal:${ripperPort}/api/channels/whatsapp-web/${hookToken}`,
        headers: { 'x-ripper-token': hookToken }, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] }
    } });
  }
  const st = await instanceState();
  if (st === 'open') return { state: 'open', qr: null };
  const q = await evo(`/instance/connect/${INSTANCE}`);
  return { state: st, qr: q.base64 || null, pairingCode: q.pairingCode || null };
}

export async function instanceState() {
  if (!(await running(API_NAME))) return 'off';
  const j = await evo(`/instance/connectionState/${INSTANCE}`).catch(e => (e.status === 404 ? { instance: { state: 'none' } } : null));
  return j?.instance?.state || 'unknown';
}

/** Desconecta o número. wipe=true apaga também containers e volumes (sessão e banco). */
export async function disconnectInstance({ wipe = false } = {}) {
  if (await running(API_NAME)) {
    await evo(`/instance/logout/${INSTANCE}`, { method: 'DELETE' }).catch(() => {});
    await evo(`/instance/delete/${INSTANCE}`, { method: 'DELETE' }).catch(() => {});
  }
  if (wipe) {
    await docker(['rm', '-f', API_NAME, DB_NAME], 60_000);
    await docker(['volume', 'rm', 'ripper-evolution-store', 'ripper-evolution-pg'], 60_000);
  }
}

/** Envia texto com "digitando…" e atraso humano (1,5–4 s) para não parecer robô. */
export async function sendText(number, text) {
  const delay = 1500 + Math.floor(Math.random() * 2500);
  return evo(`/message/sendText/${INSTANCE}`, { method: 'POST', body: { number, text: String(text).slice(0, 4096), delay } });
}

const digits = s => String(s || '').replace(/\D/g, '');

/**
 * Mensagem de texto recebida, já filtrada. null = ignorar (grupo, status, enviada por nós, mídia).
 * Contas novas usam JID @lid; o número de verdade vem em senderPn/remoteJidAlt.
 */
export function parseEvolutionMessage(ev) {
  if (ev?.event !== 'messages.upsert') return null;
  const d = ev.data || {}, k = d.key || {};
  const jid = String(k.remoteJid || '');
  if (k.fromMe || !jid || jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return null;
  const text = d.message?.conversation || d.message?.extendedTextMessage?.text || '';
  if (!text.trim()) return null;
  const phone = digits((jid.endsWith('@lid') ? (k.senderPn || k.remoteJidAlt || '') : jid).split('@')[0]);
  if (!phone) return null;
  return { id: k.id, from: phone, name: d.pushName || null, text };
}

/** Lista de números permitidos: compara só dígitos e aceita com ou sem o 9 extra de celular BR. */
export function isAllowed(phone, allowlist = []) {
  const p = digits(phone);
  const variants = n => {
    const d = digits(n);
    const out = new Set([d]);
    const m = /^55(\d{2})(9?)(\d{8})$/.exec(d); // 55 + DDD + (9) + número
    if (m) { out.add(`55${m[1]}${m[3]}`); out.add(`55${m[1]}9${m[3]}`); }
    return out;
  };
  return allowlist.some(n => variants(n).has(p));
}

/**
 * Limite de respostas: por contato e geral, por hora. ponytail: em memória (zera ao reiniciar),
 * persistir se o Ripper reiniciar muito.
 */
export function makeRateLimiter({ perContact = 20, global = 60, windowMs = 3600_000 } = {}) {
  const hits = [];
  return phone => {
    const now = Date.now();
    while (hits.length && now - hits[0].at > windowMs) hits.shift();
    if (hits.length >= global || hits.filter(h => h.phone === phone).length >= perContact) return false;
    hits.push({ phone, at: now });
    return true;
  };
}

/** Quem fala por um canal externo não pode acionar computador, navegador, plugins nem rotinas. */
export const CHANNEL_BLOCKED_TOOLS = ['computer', 'browser', 'plugins', 'social', 'routines'];
export const channelSafeAgent = agent => ({ ...agent, tools: (agent.tools || []).filter(t => !CHANNEL_BLOCKED_TOOLS.includes(t)) });
