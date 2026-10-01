import { randomUUID } from 'node:crypto';

export const CHAT_EXPORT_FORMAT = 'ripper-chat';
export const CHAT_EXPORT_VERSION = 1;

const MAX_MESSAGES = 500;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_TITLE = 80;

const ALLOWED_ROLES = new Set(['user', 'assistant', 'system']);

function sanitizeMessage(m) {
  if (!m || !ALLOWED_ROLES.has(m.role)) return null;
  const content = String(m.content ?? '').slice(0, MAX_MESSAGE_CHARS);
  const out = {
    role: m.role,
    content,
    ...(m.at ? { at: +m.at } : {}),
    ...(m.agentId ? { agentId: String(m.agentId).slice(0, 64) } : {}),
    ...(m.model ? { model: String(m.model).slice(0, 80) } : {}),
    ...(m.effort ? { effort: String(m.effort).slice(0, 16) } : {}),
    ...(m.stopped ? { stopped: true } : {}),
    ...(Array.isArray(m.files) ? { files: m.files.map(String).slice(0, 20) } : {})
  };
  return out;
}

/** Payload JSON portável (sem ids internos do servidor). */
export function exportChatPayload(chat) {
  const messages = (chat.messages || []).map(sanitizeMessage).filter(Boolean);
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return {
    format: CHAT_EXPORT_FORMAT,
    version: CHAT_EXPORT_VERSION,
    exportedAt: Date.now(),
    chat: {
      title: String(chat.title || 'Conversa').slice(0, MAX_TITLE),
      ...(chat.model ? { model: chat.model } : {}),
      ...(chat.effort ? { effort: chat.effort } : {}),
      messages
    },
    meta: {
      messageCount: messages.length,
      measuredChars: chars
    }
  };
}

/**
 * Importa conversa com validação; cria novo id e opcionalmente reassocia agente/projeto.
 * @returns {{ chat, warnings: string[] }}
 */
export function importChatPayload(db, body, { agentId, projectId, id: newId = () => randomUUID() } = {}) {
  const warnings = [];
  if (!body || body.format !== CHAT_EXPORT_FORMAT) {
    throw Object.assign(new Error('Arquivo não é um export Ripper de conversa (format ripper-chat).'), { code: 400 });
  }
  if (body.version !== CHAT_EXPORT_VERSION) {
    throw Object.assign(new Error(`Versão de export não suportada: ${body.version}.`), { code: 400 });
  }
  const raw = body.chat;
  if (!raw || !Array.isArray(raw.messages)) {
    throw Object.assign(new Error('Export inválido: falta chat.messages.'), { code: 400 });
  }
  if (raw.messages.length > MAX_MESSAGES) {
    throw Object.assign(new Error(`Export grande demais (${raw.messages.length} mensagens; máx. ${MAX_MESSAGES}).`), { code: 400 });
  }

  let resolvedAgentId = agentId;
  if (!resolvedAgentId) {
    const fromMsg = raw.messages.find(m => m.agentId)?.agentId;
    if (fromMsg && db.agents.some(a => a.id === fromMsg)) resolvedAgentId = fromMsg;
    else if (db.agents[0]) {
      resolvedAgentId = db.agents[0].id;
      warnings.push('agentId do export ignorado; usando agente padrão.');
    } else throw Object.assign(new Error('Não há agentes para importar a conversa.'), { code: 400 });
  } else if (!db.agents.some(a => a.id === resolvedAgentId)) {
    throw Object.assign(new Error('Agente não encontrado.'), { code: 404 });
  }

  if (projectId) {
    const p = db.projects.find(x => x.id === projectId);
    if (!p) throw Object.assign(new Error('Projeto não encontrado.'), { code: 404 });
    if (!p.agentIds.includes(resolvedAgentId)) {
      throw Object.assign(new Error('Agente não pertence ao projeto.'), { code: 400 });
    }
  }

  const messages = raw.messages.map(sanitizeMessage).filter(Boolean);
  const now = Date.now();
  const chat = {
    id: newId(),
    agentId: resolvedAgentId,
    title: String(raw.title || 'Conversa importada').slice(0, MAX_TITLE),
    messages: messages.map(m => ({
      id: newId(),
      ...m,
      at: m.at || now,
      ...(m.role === 'assistant' && !m.agentId ? { agentId: resolvedAgentId } : {})
    })),
    createdAt: now,
    updatedAt: now,
    ...(projectId ? { projectId } : {}),
    ...(raw.model ? { model: raw.model } : {}),
    ...(raw.effort ? { effort: raw.effort } : {})
  };
  return { chat, warnings };
}
