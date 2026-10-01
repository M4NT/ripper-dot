/**
 * Mascaramento opt-in de PII brasileira antes de chamadas a LLM/Julia
 * e execução do direito de eliminação (LGPD art. 18).
 */
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appendAudit } from './audit.mjs';
import { clearUsageEventsStore, clearJuliaEventsStore } from './data-retention.mjs';
import { deleteArtifactStorage } from './artifacts.mjs';
import { dataUrl } from './store.mjs';

export const LGPD_PLACEHOLDER = '[PII]';

export const DEFAULT_LGPD_SETTINGS = {
  enabled: false,
  redactBeforeLlm: true,
  redactInLogs: false,
  categories: {
    cpf: true,
    documents: true,
    financial: true,
    contact: true
  }
};

export function normalizeLgpdSettings(raw) {
  const base = { ...DEFAULT_LGPD_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  base.categories = { ...DEFAULT_LGPD_SETTINGS.categories, ...(base.categories || {}) };
  base.enabled = !!base.enabled;
  base.redactBeforeLlm = base.redactBeforeLlm !== false;
  base.redactInLogs = !!base.redactInLogs;
  return base;
}

export function lgpdPiiEnabled(settings) {
  return !!normalizeLgpdSettings(settings?.lgpd).enabled;
}

export function lgpdShouldRedactForLlm(settings) {
  const lgpd = normalizeLgpdSettings(settings?.lgpd);
  return lgpd.enabled && lgpd.redactBeforeLlm;
}

export function lgpdShouldRedactInLogs(settings) {
  const lgpd = normalizeLgpdSettings(settings?.lgpd);
  return lgpd.enabled && lgpd.redactInLogs;
}

/** Valida dígitos verificadores de CPF (11 dígitos). */
export function isValidCpf(digits) {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === Number(digits[10]);
}

function replaceAll(text, regex, replacer) {
  let hits = 0;
  const out = text.replace(regex, (...args) => {
    hits++;
    return typeof replacer === 'function' ? replacer(...args) : replacer;
  });
  return { text: out, hits };
}

/**
 * Mascara PII brasileira em texto livre.
 * @returns {{ text: string, hits: number, byKind: Record<string, number> }}
 */
export function redactBrazilianPii(text, options = {}) {
  if (text == null || text === '') return { text, hits: 0, byKind: {} };
  const cats = { ...DEFAULT_LGPD_SETTINGS.categories, ...(options.categories || {}) };
  const placeholder = options.placeholder || LGPD_PLACEHOLDER;
  let s = String(text);
  const byKind = {};
  const bump = (kind, n) => { byKind[kind] = (byKind[kind] || 0) + n; };

  if (cats.cpf) {
    const cpfRe = /\b(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})\b/g;
    s = s.replace(cpfRe, (full, a, b, c, d) => {
      const digits = `${a}${b}${c}${d}`;
      if (!isValidCpf(digits)) return full;
      bump('cpf', 1);
      return placeholder;
    });
  }

  if (cats.documents) {
    let r = replaceAll(s, /\bRG\s*[:\s]?\d{1,2}\.?\d{3}\.?\d{3}-?[0-9xX]\b/gi, placeholder);
    s = r.text; bump('documents', r.hits);
    r = replaceAll(s, /\bCNH\s*[:\s]?\d{11}\b/gi, placeholder);
    s = r.text; bump('documents', r.hits);
  }

  if (cats.financial) {
    let r = replaceAll(
      s,
      /\b(?:ag(?:ência|encia)?\.?\s*|ag\s*)\d{1,5}[-\s]?(?:conta|c\.?c\.?|c\/p)\s*\d{1,12}[-\s]?\d?\b/gi,
      placeholder
    );
    s = r.text; bump('financial', r.hits);
    r = replaceAll(s, /\bconta\s*(?:corrente|poupança|poupanca)?\s*[:\s]?\d{1,12}[-\s]?\d?\b/gi, placeholder);
    s = r.text; bump('financial', r.hits);
    r = replaceAll(s, /\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/g, placeholder);
    s = r.text; bump('financial', r.hits);
  }

  if (cats.contact) {
    let r = replaceAll(s, /\b(?:\+55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}\b/g, placeholder);
    s = r.text; bump('contact', r.hits);
    r = replaceAll(s, /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder);
    s = r.text; bump('contact', r.hits);
  }

  const hits = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { text: s, hits, byKind };
}

/** Middleware: texto único antes de LLM/Julia quando opt-in ativo. */
export function lgpdMiddlewareText(text, settings) {
  if (!lgpdShouldRedactForLlm(settings)) return text;
  return redactBrazilianPii(text, normalizeLgpdSettings(settings?.lgpd)).text;
}

/** Middleware: prompt + histórico + system para provedores. */
export function lgpdMiddlewareProviderPayload({ prompt, history = [], system }, settings) {
  if (!lgpdShouldRedactForLlm(settings)) return { prompt, history, system };
  const opts = normalizeLgpdSettings(settings?.lgpd);
  const redact = t => redactBrazilianPii(t, opts).text;
  return {
    prompt: redact(prompt),
    history: history.map(m => (m && typeof m.content === 'string' ? { ...m, content: redact(m.content) } : m)),
    system: system ? redact(system) : system
  };
}

export function lgpdMeta(settings) {
  const lgpd = normalizeLgpdSettings(settings?.lgpd);
  return {
    enabled: lgpd.enabled,
    redactBeforeLlm: lgpd.redactBeforeLlm,
    redactInLogs: lgpd.redactInLogs,
    categories: lgpd.categories,
    placeholder: LGPD_PLACEHOLDER
  };
}

function unlinkIfExists(path) {
  if (!path) return false;
  try {
    if (existsSync(path)) {
      unlinkSync(path);
      return true;
    }
  } catch { /* arquivo em uso ou removido */ }
  return false;
}

/**
 * Elimina dados pessoais locais (conversas, memórias, perfil, telemetria local).
 * Mantém agentes/plugins/config técnica; zera nome e instruções gerais.
 */
export async function executeLgpdErasure(db, { scope = 'all', audit = true } = {}) {
  if (!db || typeof db !== 'object') throw new Error('Banco indisponível.');
  const report = {
    scope,
    chatsRemoved: 0,
    memoriesRemoved: 0,
    filesRemoved: 0,
    artifactsRemoved: 0,
    inboxMessagesRemoved: 0,
    skillsRemoved: 0,
    approvalsRemoved: 0,
    auditEntriesRemoved: 0,
    usageEventsCleared: false,
    juliaEventsCleared: false,
    profileCleared: false
  };

  if (scope === 'profile') {
    db.settings.name = '';
    db.settings.customInstructions = '';
    report.profileCleared = true;
  } else {
    report.chatsRemoved = (db.chats || []).length;
    db.chats = [];

    report.memoriesRemoved = (db.memories || []).length;
    db.memories = [];

    report.inboxMessagesRemoved = (db.messages || []).length;
    db.messages = [];

    report.approvalsRemoved = (db.approvals || []).length;
    db.approvals = [];

    report.auditEntriesRemoved = (db.auditLog || []).length;
    db.auditLog = [];

    report.skillsRemoved = (db.skills || []).length;
    db.skills = [];

    for (const f of db.files || []) {
      try {
        if (unlinkIfExists(fileURLToPath(dataUrl(f.path)))) report.filesRemoved++;
      } catch { /* path inválido */ }
    }
    db.files = [];

    const arts = [...(db.artifacts || [])];
    for (const a of arts) {
      await deleteArtifactStorage(a).catch(() => {});
      report.artifactsRemoved++;
    }
    db.artifacts = [];

    db.settings.name = '';
    db.settings.customInstructions = '';
    report.profileCleared = true;

    try {
      clearUsageEventsStore();
      report.usageEventsCleared = true;
    } catch { /* sqlite ausente */ }
    try {
      clearJuliaEventsStore();
      report.juliaEventsCleared = true;
    } catch { /* sqlite ausente */ }
  }

  if (audit) {
    appendAudit(db, {
      type: 'lgpd_erasure',
      scope,
      at: Date.now(),
      report: {
        chatsRemoved: report.chatsRemoved,
        memoriesRemoved: report.memoriesRemoved,
        filesRemoved: report.filesRemoved
      }
    });
  }

  return report;
}
