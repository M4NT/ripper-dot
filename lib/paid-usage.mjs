// Uso pago (OpenRouter, OpenAI, Gemini, Claude por API key): só com consentimento explícito e dentro do limite do dia.
// A assinatura (Claude Code / ChatGPT) não passa por aqui: não gasta crédito.
import { DatabaseSync } from 'node:sqlite';
import { MODELS } from './router.mjs';

// Gasto num SQLite compartilhado: dois servidores no mesmo diretório somam no mesmo lugar (antes, cada um
// tinha sua cópia em db.json e o último a salvar apagava o gasto do outro). Sem arquivo (testes), fica em db.paidSpend.
let spendDb = null;
export function useSpendStore(file) {
  closeSpendStore();
  if (!file) return;
  spendDb = new DatabaseSync(file);
  spendDb.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS spend (day TEXT, agent TEXT, usd REAL NOT NULL, PRIMARY KEY (day, agent))');
}
export function closeSpendStore() {
  try { spendDb?.close(); } catch {}
  spendDb = null;
}

export const DEFAULT_LIMITS = { perAgentDailyUsd: 2, totalDailyUsd: 10 };

export function isPaidModel(model, settings) {
  const p = MODELS[model]?.provider;
  return p === 'openrouter' || p === 'openai' || p === 'gemini' || (p === 'claude' && settings?.claude?.mode === 'api');
}

export function spendLimits(settings) {
  const b = settings?.billing || {};
  return {
    perAgentDailyUsd: b.perAgentDailyUsd ?? DEFAULT_LIMITS.perAgentDailyUsd,
    totalDailyUsd: b.totalDailyUsd ?? DEFAULT_LIMITS.totalDailyUsd
  };
}

/** Normaliza settings.billing. Consentimento só liga com paidConsent === true (vira data) e desliga com false. */
export function normalizeBilling(b = {}, cur = {}) {
  const usd = (v, d) => (v == null || v === '' ? d : Math.max(0, Math.min(10_000, Math.round(+v * 100) / 100 || 0)));
  const consentAt = b.paidConsent === true ? cur.paidConsentAt || Date.now() : b.paidConsent === false ? null : cur.paidConsentAt ?? null;
  return {
    paidConsentAt: consentAt,
    perAgentDailyUsd: usd(b.perAgentDailyUsd, cur.perAgentDailyUsd ?? DEFAULT_LIMITS.perAgentDailyUsd),
    totalDailyUsd: usd(b.totalDailyUsd, cur.totalDailyUsd ?? DEFAULT_LIMITS.totalDailyUsd)
  };
}

const today = (now = Date.now()) => new Date(now).toLocaleDateString('sv'); // AAAA-MM-DD no fuso local

/** Gasto pago de hoje: { day, byAgent: { id: usd }, total }. Zera na virada do dia. */
export function spendToday(db, now) {
  const day = today(now);
  if (spendDb) {
    const byAgent = Object.fromEntries(spendDb.prepare('SELECT agent, usd FROM spend WHERE day = ?').all(day).map(r => [r.agent, r.usd]));
    db.paidSpend = { day, byAgent, total: Object.values(byAgent).reduce((a, b) => a + b, 0) };
  } else if (db.paidSpend?.day !== day) db.paidSpend = { day, byAgent: {}, total: 0 };
  return db.paidSpend;
}

/** Soma o custo de um turno. Devolve o limite que acabou de estourar ('agent' | 'total') ou null. */
export function addSpend(db, settings, agentId, usd, now) {
  if (!(usd > 0)) return null;
  if (spendDb) spendDb.exec('BEGIN IMMEDIATE'); // trava a escrita entre processos: o "antes" lido é o real
  let s, beforeAgent, beforeTotal;
  try {
    s = spendToday(db, now);
    beforeAgent = s.byAgent[agentId] || 0; beforeTotal = s.total;
    spendDb?.prepare('INSERT INTO spend (day, agent, usd) VALUES (?, ?, ?) ON CONFLICT(day, agent) DO UPDATE SET usd = usd + excluded.usd').run(s.day, agentId, usd);
    spendDb?.exec('COMMIT');
  } catch (e) { if (spendDb?.isTransaction) spendDb.exec('ROLLBACK'); throw e; }
  const lim = spendLimits(settings);
  s.byAgent[agentId] = beforeAgent + usd;
  s.total = beforeTotal + usd;
  if (beforeAgent < lim.perAgentDailyUsd && s.byAgent[agentId] >= lim.perAgentDailyUsd) return 'agent';
  if (beforeTotal < lim.totalDailyUsd && s.total >= lim.totalDailyUsd) return 'total';
  return null;
}

/** Motivo para NÃO usar um modelo pago agora, ou null se pode. */
export function paidBlockReason(db, settings, agentId, now) {
  if (!settings?.billing?.paidConsentAt) return 'Uso pago não autorizado. Ative em Configurações → Provedores de IA (gasta créditos da sua conta).';
  const s = spendToday(db, now), lim = spendLimits(settings);
  if ((s.byAgent[agentId] || 0) >= lim.perAgentDailyUsd) return `Limite diário de uso pago deste agente atingido (US$ ${lim.perAgentDailyUsd.toFixed(2)}). Volta amanhã ou aumente o limite.`;
  if (s.total >= lim.totalDailyUsd) return `Limite diário de uso pago de todos os agentes atingido (US$ ${lim.totalDailyUsd.toFixed(2)}).`;
  return null;
}
