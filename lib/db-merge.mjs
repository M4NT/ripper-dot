/**
 * Mescla dois snapshots de db.json de processos diferentes (por id e carimbo de tempo).
 */

const ID_COLLECTIONS = [
  'agents', 'chats', 'files', 'memories', 'routines', 'projects',
  'artifacts', 'messages', 'approvals', 'skills', 'agentTemplates'
];

function itemTs(item) {
  return item?.updatedAt ?? item?.decidedAt ?? item?.deliveredAt ?? item?.createdAt ?? 0;
}

export function mergeIdCollection(diskArr, localArr) {
  const byId = new Map();
  for (const item of diskArr || []) {
    if (item?.id) byId.set(item.id, item);
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
    plugins: Array.isArray(local?.plugins) ? local.plugins : (disk?.plugins ?? base.plugins)
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
export function mergePersistedDb(defaults, disk, local, usageBaseline) {
  const out = structuredClone(defaults);
  out.schemaVersion = defaults.schemaVersion;
  out.settings = mergeNestedSettings(defaults.settings, disk?.settings, local.settings);
  for (const key of ID_COLLECTIONS) {
    out[key] = mergeIdCollection(disk?.[key], local[key]);
  }
  const mergedUsage = mergeUsageByModel(disk?.usage, local.usage, usageBaseline);
  if (mergedUsage) out.usage = mergedUsage;
  if (out.usage?.events) delete out.usage.events;
  return out;
}
