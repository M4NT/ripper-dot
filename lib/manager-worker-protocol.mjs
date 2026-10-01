/**
 * Protocolo hierárquico manager → worker via inbox interno (A2A).
 * Mensagens: delegate, accept, progress, complete, reject.
 */

import { checkSend } from './inbox.mjs';
import { canDelegate, delegationDeniedMessage } from './rbac.mjs';

export const PROTOCOL_ID = 'manager-worker';

export const MESSAGE_KIND = Object.freeze({
  delegate: 'delegate',
  accept: 'accept',
  progress: 'progress',
  complete: 'complete',
  reject: 'reject'
});

/** Estados persistidos de uma delegação. */
export const DELEGATION_STATUS = Object.freeze({
  pending: 'pending',
  accepted: 'accepted',
  active: 'active',
  completed: 'completed',
  rejected: 'rejected',
  failed: 'failed'
});

const KIND_SET = new Set(Object.values(MESSAGE_KIND));

/** Corpo JSON embutido na inbox (uma linha) + texto legível abaixo. */
export function encodeProtocolEnvelope(kind, fields) {
  const env = { protocol: PROTOCOL_ID, kind, ...fields };
  return JSON.stringify(env);
}

export function parseProtocolBody(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const line = raw.split('\n').find(l => l.trim().startsWith('{'));
  if (!line) return null;
  try {
    const o = JSON.parse(line.trim());
    if (o?.protocol !== PROTOCOL_ID || !KIND_SET.has(o.kind)) return null;
    return o;
  } catch {
    return null;
  }
}

export function shapeDelegate({ delegationId, title, description, priority = 'normal' }) {
  const t = String(title || '').trim().slice(0, 200);
  const d = String(description || '').trim().slice(0, 4000);
  if (!t) return { error: 'Título da tarefa é obrigatório.' };
  if (!delegationId) return { error: 'delegationId é obrigatório.' };
  const pri = priority === 'now' || priority === 'low' ? priority : 'normal';
  return {
    ok: true,
    envelope: encodeProtocolEnvelope(MESSAGE_KIND.delegate, { delegationId, title: t, priority: pri }),
    title: t,
    description: d,
    priority: pri
  };
}

export function shapeAccept({ delegationId, note = '' }) {
  if (!delegationId) return { error: 'delegationId é obrigatório.' };
  return {
    ok: true,
    envelope: encodeProtocolEnvelope(MESSAGE_KIND.accept, {
      delegationId,
      note: String(note || '').slice(0, 500)
    })
  };
}

export function shapeProgress({ delegationId, percent, note = '' }) {
  if (!delegationId) return { error: 'delegationId é obrigatório.' };
  const p = percent == null ? null : Math.max(0, Math.min(100, Math.round(+percent)));
  return {
    ok: true,
    envelope: encodeProtocolEnvelope(MESSAGE_KIND.progress, {
      delegationId,
      percent: p,
      note: String(note || '').slice(0, 500)
    })
  };
}

export function shapeComplete({ delegationId, result = '' }) {
  if (!delegationId) return { error: 'delegationId é obrigatório.' };
  return {
    ok: true,
    envelope: encodeProtocolEnvelope(MESSAGE_KIND.complete, {
      delegationId,
      result: String(result || '').slice(0, 4000)
    })
  };
}

export function shapeReject({ delegationId, reason = '' }) {
  if (!delegationId) return { error: 'delegationId é obrigatório.' };
  const r = String(reason || '').trim().slice(0, 500);
  if (!r) return { error: 'Motivo da recusa é obrigatório.' };
  return {
    ok: true,
    envelope: encodeProtocolEnvelope(MESSAGE_KIND.reject, { delegationId, reason: r })
  };
}

export function delegationInboxBody({ envelope, title, description }) {
  return `${envelope}\n\n[Tarefa delegada: ${title}]\n${description}\n\nResponda com accept, progress, complete ou reject usando o protocolo manager-worker (JSON na primeira linha).`;
}

export function managerNotifyBody({ envelope, kind, workerName }) {
  return `${envelope}\n\n[Delegação · ${kind} · ${workerName}]`;
}

export function findDelegation(db, delegationId) {
  return (db.delegations || []).find(d => d.id === delegationId) || null;
}

function appendEvent(delegation, kind, payload, now) {
  delegation.events = delegation.events || [];
  delegation.events.push({ kind, at: now, ...payload });
  delegation.updatedAt = now;
}

/**
 * Transição de estado a partir de um evento de protocolo (worker ou sistema).
 * @returns {{ ok: true, delegation } | { error: string }}
 */
export function applyProtocolEvent(delegation, kind, payload = {}, now = Date.now()) {
  if (!delegation) return { error: 'Delegação não encontrada.' };
  switch (kind) {
    case MESSAGE_KIND.accept:
      if (delegation.status !== DELEGATION_STATUS.pending) {
        return { error: `Não dá para aceitar delegação em estado "${delegation.status}".` };
      }
      delegation.status = DELEGATION_STATUS.accepted;
      appendEvent(delegation, kind, { note: payload.note || '' }, now);
      delegation.status = DELEGATION_STATUS.active;
      return { ok: true, delegation };
    case MESSAGE_KIND.progress:
      if (delegation.status !== DELEGATION_STATUS.active && delegation.status !== DELEGATION_STATUS.accepted) {
        return { error: `Progresso inválido no estado "${delegation.status}".` };
      }
      delegation.status = DELEGATION_STATUS.active;
      delegation.progress = {
        percent: payload.percent ?? delegation.progress?.percent ?? null,
        note: payload.note || '',
        at: now
      };
      appendEvent(delegation, kind, delegation.progress, now);
      return { ok: true, delegation };
    case MESSAGE_KIND.complete:
      if (delegation.status === DELEGATION_STATUS.completed || delegation.status === DELEGATION_STATUS.rejected) {
        return { error: `Delegação já encerrada (${delegation.status}).` };
      }
      delegation.status = DELEGATION_STATUS.completed;
      delegation.result = payload.result || '';
      appendEvent(delegation, kind, { result: delegation.result }, now);
      return { ok: true, delegation };
    case MESSAGE_KIND.reject:
      if (delegation.status === DELEGATION_STATUS.completed || delegation.status === DELEGATION_STATUS.rejected) {
        return { error: `Delegação já encerrada (${delegation.status}).` };
      }
      delegation.status = DELEGATION_STATUS.rejected;
      delegation.rejectReason = payload.reason || '';
      appendEvent(delegation, kind, { reason: delegation.rejectReason }, now);
      return { ok: true, delegation };
    default:
      return { error: `Evento de protocolo desconhecido: ${kind}` };
  }
}

function defaultManagerCanDelegate({ manager, worker, db }) {
  const gate = canDelegate(
    { type: 'agent', id: manager.id },
    { type: 'agent', id: worker.id },
    'delegate_task',
    db?.accessControl,
    { agents: db?.agents || [] }
  );
  if (gate.ok) return { ok: true };
  return { error: delegationDeniedMessage(gate) || 'Delegação recusada pela política de acesso.' };
}

function resolveCanDelegate(canDelegateFn) {
  return typeof canDelegateFn === 'function' ? canDelegateFn : defaultManagerCanDelegate;
}

/**
 * Manager delega tarefa ao worker: persiste delegação + enfileira inbox interna.
 */
export function delegateTask({
  db,
  id,
  manager,
  worker,
  title,
  description,
  originChatId,
  priority = 'normal',
  hops = 0,
  limits,
  messages,
  canDelegateFn,
  now = Date.now()
}) {
  if (!db.delegations) db.delegations = [];
  if (!manager?.id || !worker?.id) return { error: 'Manager e worker são obrigatórios.' };
  const rbac = resolveCanDelegate(canDelegateFn);
  const perm = rbac({ manager, worker, db });
  if (perm?.error) return { error: perm.error };
  if (!perm?.ok) return { error: 'Delegação recusada pela política de acesso.' };

  const sendChk = checkSend({ from: manager, to: worker, messages: messages || db.messages || [], hops: hops + 1, limits, now });
  if (sendChk.error) return { error: sendChk.error };

  const delegationId = id();
  const shaped = shapeDelegate({ delegationId, title, description, priority });
  if (shaped.error) return { error: shaped.error };

  const delegation = {
    id: delegationId,
    managerId: manager.id,
    workerId: worker.id,
    title: shaped.title,
    description: shaped.description,
    status: DELEGATION_STATUS.pending,
    priority: shaped.priority,
    originChatId: originChatId || null,
    events: [{ kind: MESSAGE_KIND.delegate, at: now, title: shaped.title }],
    createdAt: now,
    updatedAt: now
  };
  db.delegations.push(delegation);

  const body = delegationInboxBody({
    envelope: shaped.envelope,
    title: shaped.title,
    description: shaped.description
  });

  const message = {
    id: id(),
    from: manager.id,
    to: worker.id,
    body,
    priority: shaped.priority,
    status: 'queued',
    hops: hops + 1,
    originChatId: originChatId || null,
    createdAt: now,
    protocol: { id: PROTOCOL_ID, kind: MESSAGE_KIND.delegate, delegationId }
  };
  db.messages.push(message);

  return { ok: true, delegation, message };
}

/**
 * Worker (ou parser da resposta da inbox) emite evento e notifica o manager pela inbox.
 */
export function workerProtocolEvent({
  db,
  id,
  worker,
  delegationId,
  kind,
  payload = {},
  hops = 0,
  limits,
  messages,
  now = Date.now()
}) {
  const delegation = findDelegation(db, delegationId);
  if (!delegation) return { error: 'Delegação não encontrada.' };
  if (delegation.workerId !== worker.id) return { error: 'Esta delegação não é sua.' };

  let shaped;
  switch (kind) {
    case MESSAGE_KIND.accept:
      shaped = shapeAccept({ delegationId, note: payload.note });
      break;
    case MESSAGE_KIND.progress:
      shaped = shapeProgress({ delegationId, percent: payload.percent, note: payload.note });
      break;
    case MESSAGE_KIND.complete:
      shaped = shapeComplete({ delegationId, result: payload.result });
      break;
    case MESSAGE_KIND.reject:
      shaped = shapeReject({ delegationId, reason: payload.reason });
      break;
    default:
      return { error: 'Tipo de resposta inválido.' };
  }
  if (shaped.error) return { error: shaped.error };

  const applied = applyProtocolEvent(delegation, kind, payload, now);
  if (applied.error) return applied;

  const manager = (db.agents || []).find(a => a.id === delegation.managerId);
  if (!manager) {
    delegation.status = DELEGATION_STATUS.failed;
    delegation.lastError = 'Manager não existe mais.';
    delegation.updatedAt = now;
    return { error: delegation.lastError };
  }

  const sendChk = checkSend({
    from: worker,
    to: manager,
    messages: messages || db.messages || [],
    hops: hops + 1,
    limits,
    now
  });
  if (sendChk.error) return { error: sendChk.error };

  const notify = {
    id: id(),
    from: worker.id,
    to: manager.id,
    body: managerNotifyBody({ envelope: shaped.envelope, kind, workerName: worker.name }),
    priority: 'normal',
    status: 'queued',
    hops: hops + 1,
    originChatId: delegation.originChatId,
    createdAt: now,
    protocol: { id: PROTOCOL_ID, kind, delegationId }
  };
  db.messages.push(notify);

  return { ok: true, delegation, notifyMessage: notify };
}

/** Interpreta resposta textual do worker na entrega da inbox e atualiza delegação. */
export function ingestWorkerInboxReply({ db, id, worker, manager, delegationId, replyText, hops, limits, now = Date.now() }) {
  const parsed = parseProtocolBody(replyText);
  if (!parsed || parsed.delegationId !== delegationId) return { skipped: true };
  return workerProtocolEvent({
    db,
    id,
    worker,
    delegationId,
    kind: parsed.kind,
    payload: {
      note: parsed.note,
      percent: parsed.percent,
      result: parsed.result,
      reason: parsed.reason
    },
    hops,
    limits,
    now
  });
}

export function delegationsSummary(delegations) {
  const counts = Object.fromEntries(Object.values(DELEGATION_STATUS).map(s => [s, 0]));
  for (const d of delegations || []) {
    const s = d.status || DELEGATION_STATUS.pending;
    if (counts[s] != null) counts[s]++;
    else counts.pending++;
  }
  return counts;
}
