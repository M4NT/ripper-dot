/**
 * Checklist determinístico do auditor X9 (somente leitura, sem mutação).
 */

function finding(severity, code, message, remediationSuggestion, extra = {}) {
  return { severity, code, message, remediationSuggestion, ...extra };
}

function lgpdEffective(settings, lgpdApi) {
  if (settings.privacy && typeof settings.privacy.lgpdEnabled === 'boolean') {
    return { known: true, enabled: settings.privacy.lgpdEnabled, via: 'settings.privacy.lgpdEnabled' };
  }
  if (lgpdApi?.available) {
    return {
      known: true,
      enabled: lgpdApi.productTelemetry !== true,
      via: 'api/lgpd/status (telemetria de produto)'
    };
  }
  return { known: false, enabled: null, via: null };
}

function retentionEffective(settings) {
  if (settings.dataRetention && typeof settings.dataRetention.autoPurgeEnabled === 'boolean') {
    return { known: true, enabled: settings.dataRetention.autoPurgeEnabled, via: 'settings.dataRetention.autoPurgeEnabled' };
  }
  return { known: false, enabled: null, via: null };
}

/** @param {{ db, settings, sources?: object, env?: object }} ctx */
export function runX9Scan(ctx) {
  const { db, settings, env = process.env } = ctx;
  const sources = ctx.sources;
  const findings = [];
  const s = settings;
  const policy = s.approvalPolicy || 'risky';
  const inbox = s.inbox || { maxPerHour: 20, maxHops: 3 };
  const computer = s.computer || {};
  const host = env.HOST || '127.0.0.1';
  const token = env.RIPPER_TOKEN || '';

  if (host !== '127.0.0.1' && host !== 'localhost' && !token) {
    findings.push(finding(
      'critical',
      'AUTH_EXPOSED_NO_TOKEN',
      `O servidor escuta em ${host} sem RIPPER_TOKEN configurado.`,
      'Defina RIPPER_TOKEN com um segredo longo ou volte HOST para 127.0.0.1.'
    ));
  }

  if (computer.mode === 'off') {
    findings.push(finding(
      'high',
      'SANDBOX_COMPUTER_OFF',
      'O computador dos agentes está desligado (settings.computer.mode = off).',
      'Ative Docker ou boat.dev em Configurações → Modelos e computador, se precisar de isolamento por agente.'
    ));
  }

  if (computer.mode === 'local' && computer.allowLocalCommands) {
    findings.push(finding(
      'high',
      'SANDBOX_LOCAL_HOST',
      'Modo pasta local com comandos locais permitidos: agentes podem executar na máquina anfitriã (com aprovações conforme a política).',
      'Prefira Docker ou boat.dev para isolamento; mantenha aprovação em "Só ações de risco" ou "Toda ação".'
    ));
  }

  const lgpd = lgpdEffective(s, sources?.lgpd);
  if (!lgpd.known) {
    findings.push(finding(
      'info',
      'LGPD_STATUS_UNKNOWN',
      sources?.lgpd?.reason || 'Status LGPD indisponível: não há API /api/lgpd/status nem settings.privacy.lgpdEnabled.',
      'Revise docs/privacidade-e-dados.md e configure políticas de dados manualmente até haver integração LGPD.'
    ));
  } else if (!lgpd.enabled) {
    findings.push(finding(
      'medium',
      'LGPD_DISABLED',
      `Proteções LGPD reportadas como desligadas (${lgpd.via}).`,
      'Ative LGPD nas configurações de privacidade quando disponível, ou documente o tratamento de dados pessoais.'
    ));
  }

  const retention = retentionEffective(s);
  if (!retention.known) {
    findings.push(finding(
      'info',
      'RETENTION_POLICY_UNKNOWN',
      'Não há política automática de retenção/purge configurada (settings.dataRetention.autoPurgeEnabled ausente).',
      'Use scripts/ripper-data.mjs para inventário e limpeza opt-in; defina retenção quando o produto expor a opção.'
    ));
  } else if (!retention.enabled) {
    findings.push(finding(
      'medium',
      'RETENTION_DISABLED',
      'Purge automático de dados locais está desligado.',
      'Ative dataRetention.autoPurgeEnabled ou agende limpeza manual de usage.sqlite e eventos Julia.'
    ));
  }

  if (policy === 'never') {
    findings.push(finding(
      'critical',
      'APPROVAL_NEVER',
      'Política de aprovação em "Nunca pedir": comandos no computador podem rodar sem confirmação (exceto pasta local, que sempre pede).',
      'Em Configurações → Segurança, use "Só ações de risco" ou "Toda ação".'
    ));
  }

  if (+inbox.maxPerHour > 60) {
    findings.push(finding(
      'medium',
      'INBOX_HIGH_RATE',
      `Limite de mensagens entre agentes é alto (${inbox.maxPerHour}/hora).`,
      'Reduza inbox.maxPerHour para reduzir autonomia em cadeia entre agentes.'
    ));
  }
  if (+inbox.maxHops > 5) {
    findings.push(finding(
      'medium',
      'INBOX_DEEP_CHAIN',
      `Profundidade máxima entre agentes é ${inbox.maxHops} saltos.`,
      'Mantenha inbox.maxHops em 3–5 para evitar loops longos.'
    ));
  }

  const riskyAgents = db.agents.filter(a => a.status !== 'paused' && a.tools?.includes('computer') && a.tools?.includes('plugins'));
  if (riskyAgents.length > 0 && policy !== 'always') {
    findings.push(finding(
      'medium',
      'AGENTS_COMPUTER_AND_PLUGINS',
      `${riskyAgents.length} agente(s) ativo(s) com computador e plugins MCP: ${riskyAgents.map(a => a.name).slice(0, 5).join(', ')}${riskyAgents.length > 5 ? '…' : ''}.`,
      'Pause agentes não essenciais ou exija aprovação "Toda ação" enquanto auditar integrações.'
    ));
  }

  const httpPlugins = (s.plugins || []).filter(p => p.type === 'http' && p.enabled !== false);
  const httpNoAuth = httpPlugins.filter(p => !p.auth?.oauth?.accessToken && !p.auth?.apiKey);
  if (httpNoAuth.length) {
    findings.push(finding(
      'low',
      'MCP_HTTP_WITHOUT_AUTH',
      `Conectores HTTP sem OAuth/chave configurada: ${httpNoAuth.map(p => p.name).join(', ')}.`,
      'Configure autenticação nos conectores ou desative os que não são necessários.'
    ));
  }

  if (s.memory === false) {
    findings.push(finding(
      'low',
      'MEMORY_DISABLED',
      'Memória global desligada — agentes não persistem fatos entre conversas.',
      'Ligue memória se precisar de contexto; mantenha desligada se quiser minimizar dados guardados.'
    ));
  }

  const denied = (db.auditLog || []).filter(e => e.status === 'denied').length;
  const expired = (db.auditLog || []).filter(e => e.status === 'expired').length;
  if (denied + expired >= 5) {
    findings.push(finding(
      'info',
      'AUDIT_MANY_DENIALS',
      `Histórico local registra ${denied} negação(ões) e ${expired} expiração(ões) de aprovação.`,
      'Revise o histórico em Configurações → Segurança e ajuste políticas ou treinamento dos agentes.'
    ));
  }

  if (sources && sources.adminOverview && !sources.adminOverview.available) {
    findings.push(finding(
      'info',
      'API_ADMIN_OVERVIEW_UNAVAILABLE',
      sources.adminOverview.reason || 'Visão admin indisponível.',
      'Ative o modo enterprise para /api/admin/overview e o Centro admin.'
    ));
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  return {
    findings,
    summary: {
      total: findings.length,
      bySeverity: findings.reduce((o, f) => (o[f.severity] = (o[f.severity] || 0) + 1, o), {})
    }
  };
}
