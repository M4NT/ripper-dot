import { TOOLS, AVATAR_TYPES, newAgent, patchAgent } from './store.mjs';

const MAX_SAVED = 40;

export function listAgentTemplates(db) {
  return (db.agentTemplates || []).slice().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
}

export function patchSavedTemplate(t, body) {
  if (typeof body.name === 'string' && body.name.trim()) t.name = body.name.trim().slice(0, 60);
  if (typeof body.description === 'string') t.description = body.description.slice(0, 200);
  if (typeof body.category === 'string') t.category = body.category.slice(0, 40);
  if (typeof body.instructions === 'string') t.instructions = body.instructions.slice(0, 8000);
  if (typeof body.tone === 'string') t.tone = body.tone.slice(0, 20);
  if (['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(body.effort)) t.effort = body.effort;
  if (typeof body.model === 'string') t.model = body.model.slice(0, 80);
  if (Array.isArray(body.tools)) t.tools = body.tools.filter(x => TOOLS.includes(x));
  if (body.avatar && typeof body.avatar === 'object') {
    t.avatar = {
      type: AVATAR_TYPES.includes(body.avatar.type) ? body.avatar.type : t.avatar?.type,
      color: body.avatar.color ?? t.avatar?.color ?? null,
      face: body.avatar.face === 'mouth' ? 'mouth' : 'eyes'
    };
  }
  if (body.builtinTemplateId) t.builtinTemplateId = String(body.builtinTemplateId).slice(0, 40);
  t.updatedAt = Date.now();
  return t;
}

export function createSavedTemplate(db, body, { id }) {
  if (!db.agentTemplates) db.agentTemplates = [];
  if (db.agentTemplates.length >= MAX_SAVED) {
    throw Object.assign(new Error(`Limite de ${MAX_SAVED} modelos salvos.`), { code: 409 });
  }
  const base = newAgent(body);
  const t = {
    id,
    name: base.name,
    description: base.description,
    category: base.category,
    instructions: base.instructions,
    tone: base.tone,
    model: base.model,
    effort: base.effort,
    tools: base.tools,
    avatar: base.avatar,
    builtinTemplateId: body.builtinTemplateId || body.templateId || null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  patchSavedTemplate(t, body);
  db.agentTemplates.unshift(t);
  return t;
}

/** Aplica modelo salvo + overrides ao criar agente. */
export function agentFromSavedTemplate(db, savedId, body, builtinTemplates = []) {
  const saved = (db.agentTemplates || []).find(x => x.id === savedId);
  if (!saved) throw Object.assign(new Error('Modelo salvo não encontrado.'), { code: 404 });
  const builtin = saved.builtinTemplateId && builtinTemplates.find(t => t.id === saved.builtinTemplateId);
  const seed = { ...saved, templateId: saved.builtinTemplateId || null };
  delete seed.id;
  delete seed.createdAt;
  delete seed.updatedAt;
  delete seed.builtinTemplateId;
  const a = patchAgent(newAgent({ ...(builtin || {}), ...seed, templateId: saved.builtinTemplateId || null }), body);
  a.templateId = saved.builtinTemplateId || saved.id;
  a.savedTemplateId = saved.id;
  return a;
}
