import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { listAudit } from './audit.mjs';
import { summarizeLocalData, resolveRipperDataDir } from './data-retention.mjs';
import { isEnterpriseMode } from './enterprise.mjs';
import { buildLgpdStatus } from './lgpd-status.mjs';
import { accountLimits } from './usage.mjs';

function countSandboxAgents() {
  const dir = join(resolveRipperDataDir(), 'sandbox');
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter(name => {
      try {
        return existsSync(join(dir, name));
      } catch {
        return false;
      }
    }).length;
  } catch {
    return 0;
  }
}

/** Agrega apenas flags e contagens reais para o Admin Center. */
export function buildAdminOverview(db, settings) {
  const enterprise = isEnterpriseMode(settings);
  const auditEntries = listAudit(db, { limit: 1 });
  const auditTotal = (db.auditLog || []).length;
  const data = summarizeLocalData();
  const limits = accountLimits(db, settings);
  const budgetSignals =
    Boolean(limits.live?.usageEvents)
    || Boolean(limits.ripperQuota?.rolling5h?.configured)
    || Boolean(limits.ripperQuota?.weekly?.configured)
    || Boolean(limits.cloudCredits?.configured)
    || Boolean(limits.juliaRouting)
    || Boolean(limits.live?.providerBilling)
    || Boolean(limits.live?.providerQuotaSignals)
    || (limits.providers?.length || 0) > 0;

  const computerMode = settings?.computer?.mode || 'off';
  const sandboxDirs = countSandboxAgents();

  return {
    enterprise,
    generatedAt: Date.now(),
    sections: {
      rbac: {
        available: false,
        multiUser: false,
        auth: process.env.RIPPER_TOKEN?.trim() ? 'ripper_token' : 'none',
        agents: db.agents?.length ?? 0,
        emptyLabel: 'RBAC multiusuário não está disponível nesta instalação.'
      },
      auditTrail: {
        available: true,
        endpoint: '/api/audit-trail',
        legacyEndpoint: '/api/audit',
        worm: false,
        entryCount: auditTotal,
        recentSample: auditEntries.length > 0,
        emptyLabel: auditTotal === 0 ? 'Nenhum evento de auditoria registrado ainda.' : null
      },
      retention: {
        available: true,
        ripperData: data.ripperData,
        fromEnv: data.fromEnv,
        usageEventCount: data.usageEventCount,
        juliaDecisionCount: data.juliaDecisionCount,
        fileCount: data.files.length,
        directoryCount: data.directories.length,
        notes: 'Retenção de chats é manual; eventos de uso e Julia usam ring buffer (até 800).'
      },
      lgpd: {
        available: true,
        endpoint: '/api/lgpd/status',
        ...buildLgpdStatus({ settings })
      },
      sandbox: {
        available: computerMode !== 'off',
        computerMode,
        sandboxAgentDirs: sandboxDirs,
        emptyLabel: computerMode === 'off'
          ? 'Computador desligado — sem sandboxes ativos.'
          : (sandboxDirs === 0 ? 'Nenhuma pasta sandbox de agente ainda.' : null)
      },
      budget: {
        available: budgetSignals,
        endpoint: '/api/usage/limits',
        plan: limits.plan ?? null,
        hasProviderSnapshot: Boolean(limits.live?.providerBilling || limits.live?.providerQuotaSignals),
        hasLocalUsageEvents: Boolean(limits.live?.usageEvents),
        emptyLabel: budgetSignals ? null : 'sem dados',
        notes: 'Sem valores de fatura inventados — só sinais e cotas configuradas ou reportadas pelo provedor.'
      }
    }
  };
}
