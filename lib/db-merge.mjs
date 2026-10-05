/**
 * Mescla dois snapshots de db.json de processos diferentes (por id e carimbo de tempo).
 */

import { mergeAccessControl } from './rbac.mjs';

export const ID_COLLECTIONS = [
  'agents', 'chats', 'files', 'memories', 'routines', 'projects',
  'artifacts', 'messages', 'delegations', 'taskItems', 'approvals', 'skills', 'agentTemplates', 'taskDelegations', 'teamProposals', 'spendAlerts', 'systemAlerts'
];

function itemTs(item) {
  return item?.updatedAt ?? item?.decidedAt ?? item?.deliveredAt ?? item?.createdAt ?? 0;
}

/** deleted: ids que ESTE processo apagou desde o último load/flush — não podem voltar do disco. */
export function mergeIdCollection(diskArr, localArr, deleted = new Set()) {
  const byId = new Map();
  for (const item of diskArr || []) {
    if (item?.id && !deleted.has(item.id)) byId.set(item.id, item);
  }
  for (const item of localArr || []) {
    if (!item?.id) continue;
    const prev = byId.get(item.id);
    if (!prev || itemTs(item) >= itemTs(prev)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function mergeNestedSettings(base, disk, local) {
  return {
    ...base,
    ...disk,
    ...local,
    claude: { ...base.claude, ...disk?.claude, ...local?.claude },
    chatgpt: { ...base.chatgpt, ...disk?.chatgpt, ...local?.chatgpt },
    computer: { ...base.computer, ...disk?.computer, ...local?.computer },
    julia: { ...base.julia, ...disk?.julia, ...local?.julia },
    flags: { ...base.flags, ...disk?.flags, ...local?.flags },
    enterprise: { ...base.enterprise, ...disk?.enterprise, ...local?.enterprise },
    ui: { ...base.ui, ...disk?.ui, ...local?.ui },
    plugins: Array.isArray(local?.plugins) ? local.plugins : (disk?.plugins ?? base.plugins),
    taskSync: {
      ...(base.taskSync || {}),
      ...(disk?.taskSync || {}),
      ...(local?.taskSync || {}),
      google: {
        ...(base.taskSync?.google || {}),
        ...(disk?.taskSync?.google || {}),
        ...(local?.taskSync?.google || {})
      }
    }
  };
}

function counterRow(row) {
  return {
    requests: row?.requests || 0,
    charsIn: row?.charsIn || 0,
    charsOut: row?.charsOut || 0
  };
}

/** Contadores por modelo: disco + delta local desde o baseline do processo. */
export function mergeUsageByModel(diskUsage, localUsage, baselineByModel) {
  const disk = diskUsage?.byModel || {};
  const local = localUsage?.byModel || {};
  const base = baselineByModel || {};
  const models = new Set([...Object.keys(disk), ...Object.keys(local), ...Object.keys(base)]);
  const byModel = {};
  for (const model of models) {
    const d = counterRow(disk[model]);
    const l = counterRow(local[model]);
    const b = counterRow(base[model]);
    byModel[model] = {
      requests: d.requests + (l.requests - b.requests),
      charsIn: d.charsIn + (l.charsIn - b.charsIn),
      charsOut: d.charsOut + (l.charsOut - b.charsOut)
    };
  }
  const providers = { ...(diskUsage?.providers || {}) };
  for (const [name, sig] of Object.entries(localUsage?.providers || {})) {
    const prev = providers[name];
    if (!prev || (sig.at || 0) >= (prev.at || 0)) providers[name] = sig;
  }
  return {
    byModel,
    providers,
    updatedAt: Math.max(diskUsage?.updatedAt || 0, localUsage?.updatedAt || 0, Date.now())
  };
}

/**
 * @param {object} defaults - DEFAULT do store (schema e settings padrão)
 * @param {object|null} disk
 * @param {object} local - estado em memória deste processo
 * @param {object} usageBaseline - snapshot de usage.byModel no último load/flush
 */
export function mergePersistedDb(defaults, disk, local, usageBaseline, idBaseline = {}) {
  const out = structuredClone(defaults);
  out.schemaVersion = defaults.schemaVersion;
  out.settings = mergeNestedSettings(defaults.settings, disk?.settings, local.settings);
  for (const key of ID_COLLECTIONS) {
    // Existia no último load/flush e sumiu daqui = foi apagado aqui. Novo no disco (outro processo) continua.
    const here = new Set((local[key] || []).map(x => x?.id));
    const deleted = new Set([...(idBaseline[key] || [])].filter(i => !here.has(i)));
    out[key] = mergeIdCollection(disk?.[key], local[key], deleted);
  }
  out.accessControl = mergeAccessControl(defaults.accessControl, disk?.accessControl, local.accessControl);
  const mergedUsage = mergeUsageByModel(disk?.usage, local.usage, usageBaseline);
  if (mergedUsage) out.usage = mergedUsage;
  if (out.usage?.events) delete out.usage.events;
  // ponytail: o processo que gravou por último vence; somar entre processos se houver vários servidores
  out.paidSpend = local.paidSpend ?? disk?.paidSpend ?? null;
  out.credentialVault = { ...(disk?.credentialVault || {}), ...(local.credentialVault || {}) };
  // Qualquer outra chave (auditLog, juliaCorrections, coleções novas): a versão deste processo vence; senão a do disco.
  // Antes voltavam ao padrão a cada gravação.
  const handled = new Set(['schemaVersion', 'settings', 'accessControl', 'usage', 'paidSpend', 'credentialVault', ...ID_COLLECTIONS]);
  for (const key of new Set([...Object.keys(disk || {}), ...Object.keys(local)])) {
    if (!handled.has(key)) out[key] = key in local ? local[key] : disk[key];
  }
  return out;
}
