// Várias contas do Claude por assinatura (ex.: Pro pessoal e Teams da empresa).
// Cada conta extra é uma pasta de configuração do Claude Code (CLAUDE_CONFIG_DIR) fora de data/:
// o login (token OAuth) nunca entra nos backups do Ripper. 'principal' = o login de sempre desta máquina.
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PRINCIPAL = 'principal';
export const ACCOUNTS_ROOT = join(homedir(), '.ripper', 'claude-accounts');
const MAX_ACCOUNTS = 5;

const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

/** Lista vinda do navegador → [{ id, label }] (sem a principal, que sempre existe). */
export function normalizeAccounts(list, cur = []) {
  const out = [];
  for (const a of Array.isArray(list) ? list : cur) {
    const label = String(a?.label || '').trim().slice(0, 40);
    const id = a?.id && a.id !== PRINCIPAL ? slug(a.id) : slug(label);
    if (!label || !id || id === PRINCIPAL || out.some(x => x.id === id)) continue;
    out.push({ id, label });
    if (out.length >= MAX_ACCOUNTS) break;
  }
  return out;
}

export function allAccounts(settings) {
  return [{ id: PRINCIPAL, label: settings?.claude?.principalLabel || 'Conta pessoal' }, ...(settings?.claude?.accounts || [])];
}

export const configDirOf = id => (id && id !== PRINCIPAL ? join(ACCOUNTS_ROOT, id) : null);

/** Variáveis de ambiente para usar a conta: sem CLAUDE_CONFIG_DIR = login principal. */
export function applyAccountEnv(env, id) {
  const dir = configDirOf(id);
  if (dir) { mkdirSync(dir, { recursive: true }); env.CLAUDE_CONFIG_DIR = dir; }
  else delete env.CLAUDE_CONFIG_DIR;
  return env;
}

export function isLoggedIn(id) {
  return existsSync(join(configDirOf(id) || join(homedir(), '.claude'), '.credentials.json'));
}

// Conta que bateu o limite da assinatura: fica de lado até o reset (ou 1 h se não soubermos quando).
// ponytail: em memória; reiniciar o Ripper volta a tentar todas (no máximo uma falha a mais por conta).
const exhausted = new Map();
export function markExhausted(id, resetAt) { exhausted.set(id, resetAt && resetAt > Date.now() ? resetAt : Date.now() + 3600_000); }
export function exhaustedUntil(id) { const t = exhausted.get(id); if (t && t <= Date.now()) exhausted.delete(id); return exhausted.get(id) || null; }

/** Ordem de tentativa: conta do agente (ou a padrão) primeiro, depois as outras logadas e fora do limite. */
export function accountOrder(settings, agent) {
  const all = allAccounts(settings).map(a => a.id);
  const first = all.includes(agent?.claudeAccount) ? agent.claudeAccount : all.includes(settings?.claude?.defaultAccount) ? settings.claude.defaultAccount : PRINCIPAL;
  const rest = all.filter(id => id !== first && isLoggedIn(id) && !exhaustedUntil(id));
  return settings?.claude?.autoSwitch === false ? [first] : [first, ...rest];
}

/** Erro de limite da assinatura (5 h / semanal) ou rate limit. */
export const isLimitError = e => /usage limit|hit your (?:\w+ )?limit|limit reached|rate[_\s-]?limit|429|too many requests/i.test(String(e?.message || e || ''));

/** "resets 5:20pm" / "resets 17:20" → horário (hoje ou amanhã, fuso desta máquina). null se não houver. */
export function limitResetAt(e, now = new Date()) {
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(String(e?.message || e || ''));
  if (!m) return null;
  const ap = m[3]?.toLowerCase();
  const h = ap ? (+m[1] % 12) + (ap === 'pm' ? 12 : 0) : +m[1];
  const t = new Date(now); t.setHours(h, +(m[2] || 0), 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t.getTime();
}

/** Comando para logar a conta num terminal (o login do Claude Code é interativo). */
export function loginCommand(id) {
  const dir = configDirOf(id);
  if (process.platform === 'win32') return dir ? `set "CLAUDE_CONFIG_DIR=${dir}" && claude /login` : 'claude /login';
  return dir ? `CLAUDE_CONFIG_DIR="${dir}" claude /login` : 'claude /login';
}

/** Abre um terminal nesta máquina já no login da conta (Windows e macOS). Linux: devolve false e a tela mostra o comando. */
export function openLoginTerminal(id) {
  const dir = configDirOf(id);
  if (dir) mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    // sem aspas internas: o cmd /k recebe a linha inteira; "set X=...&&" não deixa espaço no fim do valor
    const line = `${dir ? `set CLAUDE_CONFIG_DIR=${dir}&& ` : ''}claude /login`;
    spawn('cmd.exe', ['/c', 'start', 'Login do Claude', 'cmd', '/k', line], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (process.platform === 'darwin') {
    spawn('osascript', ['-e', `tell application "Terminal" to do script "${loginCommand(id).replace(/"/g, '\\"')}"`], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  return false;
}

const infoCache = new Map(); // conta → { email, organization, plan } do último teste
export const cachedAccountInfo = id => infoCache.get(id) || null;

/** Testa a conta sem gastar mensagem: abre o Claude Code com ela e lê e-mail, organização e plano. */
export async function testAccount(id, fastEnv = {}) {
  const env = applyAccountEnv({ ...process.env, ...fastEnv }, id);
  delete env.ANTHROPIC_API_KEY;
  const idle = (async function* () { await new Promise(() => {}); })();
  const q = query({ prompt: idle, options: { env, tools: [], settingSources: [], model: 'claude-haiku-4-5' } });
  try {
    const info = await Promise.race([q.accountInfo(), new Promise((_, rej) => setTimeout(() => rej(new Error('Sem resposta do Claude Code em 30 s.')), 30_000))]);
    if (!info?.email) return { ok: false, error: 'Esta conta ainda não fez login.' };
    const out = { ok: true, email: info.email, organization: info.organization, plan: info.subscriptionType };
    infoCache.set(id, out);
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  } finally { try { q.close(); } catch {} }
}
