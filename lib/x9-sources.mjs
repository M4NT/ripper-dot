import { listAudit } from './audit.mjs';
import { summarizeLocalData } from './data-retention.mjs';
import { redactSettingsSecrets } from './mcp-connectors.mjs';
import { buildLgpdStatus } from './lgpd-status.mjs';
import { buildAdminOverview } from './admin-overview.mjs';
import { isEnterpriseMode } from './enterprise.mjs';

const MISSING = {
  sandboxApi: 'Endpoint GET /api/sandbox/status não está disponível nesta instalação.'
};

/** Estado do isolamento derivado das configurações reais (sem endpoint dedicado). */
export function deriveSandboxStatus(settings) {
  const mode = settings.computer?.mode ?? 'boat';
  return {
    source: 'settings.computer.mode',
    mode,
    sandboxActive: mode === 'docker' || mode === 'boat',
    computerOff: mode === 'off',
    localHost: mode === 'local',
    allowLocalCommands: !!settings.computer?.allowLocalCommands
  };
}

function normalizeSettings(settings) {
  return {
    memory: true,
    approvalPolicy: 'risky',
    inbox: { maxPerHour: 20, maxHops: 3 },
    claude: { mode: 'subscription', apiKey: '', useConnectors: true },
    computer: { mode: 'boat', allowLocalCommands: false, idleStopMinutes: 10 },
    plugins: [],
    ...settings,
    claude: { mode: 'subscription', apiKey: '', useConnectors: true, ...(settings?.claude || {}) },
    computer: { mode: 'boat', allowLocalCommands: false, idleStopMinutes: 10, ...(settings?.computer || {}) },
    inbox: { maxPerHour: 20, maxHops: 3, ...(settings?.inbox || {}) }
  };
}

/** Pacote de respostas internas equivalentes às APIs HTTP (sem fetch). */
export function x9RemoteFromDb(db, settings) {
  const lgpd = buildLgpdStatus({ settings });
  const remote = {
    lgpd: { available: true, ...lgpd },
    sandbox: { available: false, reason: MISSING.sandboxApi }
  };
  if (isEnterpriseMode(settings)) {
    remote.adminOverview = { available: true, data: buildAdminOverview(db, settings) };
  } else {
    remote.adminOverview = {
      available: false,
      reason: 'GET /api/admin/overview exige modo enterprise.'
    };
  }
  const overviewSandbox = remote.adminOverview.available
    ? remote.adminOverview.data?.sections?.sandbox
    : null;
  if (overviewSandbox) {
    remote.sandbox = { available: true, fromAdminOverview: true, ...overviewSandbox };
  }
  return remote;
}

/**
 * Coleta fontes somente leitura para o auditor X9.
 * Passe `remote` para sobrescrever; por padrão usa x9RemoteFromDb quando `db` é informado.
 */
export function collectX9Sources({ db, settings, env = process.env, remote }) {
  const normalized = normalizeSettings(settings || {});
  const redacted = redactSettingsSecrets(normalized);
  const auditEntries = listAudit(db, { limit: 30 });
  const localData = summarizeLocalData();

  const resolvedRemote = remote ?? (db ? x9RemoteFromDb(db, normalized) : {});
  const adminOverview = resolvedRemote.adminOverview ?? { available: false, reason: 'Fonte admin indisponível.' };
  const lgpd = resolvedRemote.lgpd ?? { available: false, reason: 'Fonte LGPD indisponível.' };
  const sandboxApi = resolvedRemote.sandbox ?? { available: false, reason: MISSING.sandboxApi };

  return {
    scannedAt: Date.now(),
    ripperTokenConfigured: Boolean(env.RIPPER_TOKEN),
    hostBinding: env.HOST || '127.0.0.1',
    enterpriseMode: isEnterpriseMode(normalized),
    ripperSettings: {
      available: true,
      snapshot: {
        approvalPolicy: redacted.approvalPolicy || 'risky',
        memory: redacted.memory !== false,
        memoryLogInContext: redacted.memoryLogInContext ?? 10,
        inbox: redacted.inbox || { maxPerHour: 20, maxHops: 3 },
        computer: redacted.computer,
        ui: redacted.ui || { mode: 'simple' },
        privacy: redacted.privacy || null,
        dataRetention: redacted.dataRetention || null,
        claude: { mode: redacted.claude?.mode, useConnectors: redacted.claude?.useConnectors },
        pluginCount: (redacted.plugins || []).length,
        pluginsEnabled: (redacted.plugins || []).filter(p => p.enabled !== false).length
      }
    },
    agents: {
      available: true,
      total: db.agents.length,
      online: db.agents.filter(a => a.status !== 'paused').length,
      withComputer: db.agents.filter(a => a.tools?.includes('computer')).length,
      withPlugins: db.agents.filter(a => a.tools?.includes('plugins')).length,
      withWeb: db.agents.filter(a => a.tools?.includes('web')).length
    },
    audit: {
      available: true,
      recentCount: auditEntries.length,
      entries: auditEntries.slice(0, 15)
    },
    adminOverview,
    lgpd,
    sandbox: {
      derived: deriveSandboxStatus(normalized),
      api: sandboxApi
    },
    localData: {
      available: true,
      ripperData: localData.ripperData,
      fromEnv: localData.fromEnv,
      usageEventCount: localData.usageEventCount,
      juliaDecisionCount: localData.juliaDecisionCount
    },
    pendingApprovals: (db.approvals || []).filter(a => a.status === 'pending').length
  };
}
