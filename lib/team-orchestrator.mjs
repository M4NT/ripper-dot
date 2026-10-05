/**
 * Meta-prompting: brief em linguagem natural → estrutura de time (papéis, agentes, inbox).
 * RBAC (#28) e protocolo manager-worker (#29): só metadados (permissions, managerKey) — sem enforcement.
 */

import { newAgent, patchAgent, id as newId, TOOLS } from './store.mjs';
import { TEMPLATES, CATEGORIES } from './templates.mjs';
import { appendAudit } from './audit.mjs';
import { runTestProvider, stripTestDirective } from './test-provider.mjs';
import { architectSuggest } from './architect-suggest.mjs';
import { z } from 'zod';
import { askWithContract } from './model-contract.mjs';

const MAX_AGENTS = 12;
const MAX_ROLES = 8;

export const TEAM_STRUCTURE_VERSION = 1;

const slug = s => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'agent';

/** Extrai JSON de bloco markdown ou texto solto. */
export function extractJsonBlob(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text || '');
  const raw = fenced ? fenced[1].trim() : String(text || '').trim();
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    const inner = /\{[\s\S]*"agents"\s*:\s*\[[\s\S]*\}[\s\S]*\}/.exec(raw);
    if (!inner) return null;
    return inner[0];
  }
  return raw;
}

function pickCategory(text) {
  const t = String(text || '').toLowerCase();
  for (const c of CATEGORIES) {
    if (t.includes(c.toLowerCase())) return c;
  }
  if (/venda|lead|comercial/.test(t)) return 'Vendas';
  if (/market|conteúdo|conteudo|copy/.test(t)) return 'Marketing';
  if (/dado|planilha|analis/.test(t)) return 'Dados';
  if (/código|codigo|dev|software/.test(t)) return 'Operações';
  if (/atend|suporte|cliente/.test(t)) return 'Atendimento';
  if (/pesquis/.test(t)) return 'Pesquisa';
  return 'Outro';
}

function matchBuiltinTemplate(agentLike) {
  const bag = `${agentLike.name} ${agentLike.description} ${agentLike.category} ${agentLike.instructions || ''}`.toLowerCase();
  let best = null, score = 0;
  for (const t of TEMPLATES) {
    let s = 0;
    if (bag.includes(t.name.toLowerCase().slice(0, 8))) s += 2;
    if (t.category && bag.includes(t.category.toLowerCase())) s += 1;
    if (t.description && bag.includes(t.description.toLowerCase().slice(0, 12))) s += 1;
    if (s > score) { score = s; best = t; }
  }
  return best;
}

function normalizeRole(r, idx) {
  const name = String(r?.name || r?.title || `Papel ${idx + 1}`).trim().slice(0, 80);
  return {
    id: String(r?.id || slug(name) || `role-${idx}`).slice(0, 48),
    name,
    purpose: String(r?.purpose || r?.description || '').trim().slice(0, 400)
  };
}

function normalizeAgentDraft(a, idx, rolesById) {
  const name = String(a?.name || a?.title || `Agente ${idx + 1}`).trim().slice(0, 60);
  const key = String(a?.key || slug(name) || `a${idx}`).slice(0, 48);
  const description = String(a?.description || a?.purpose || '').trim().slice(0, 200);
  const category = CATEGORIES.includes(a?.category) ? a.category : pickCategory(`${name} ${description}`);
  const builtin = a?.templateId ? TEMPLATES.find(t => t.id === a.templateId) : matchBuiltinTemplate({ name, description, category });
  const tools = Array.isArray(a?.tools)
    ? a.tools.filter(t => TOOLS.includes(t))
    : (builtin?.tools || ['web', 'memory', 'routines', 'files']);
  const roleId = a?.roleId && rolesById.has(a.roleId) ? a.roleId : (a?.role && rolesById.get(slug(a.role))?.id) || null;
  const managerKey = a?.managerKey != null ? String(a.managerKey).slice(0, 48) : (a?.manager != null ? slug(a.manager) : null);
  const permissions = a?.permissions && typeof a.permissions === 'object'
    ? structuredClone(a.permissions)
    : undefined;
  return {
    key,
    roleId,
    name,
    description,
    category,
    instructions: String(a?.instructions || builtin?.instructions || description).trim().slice(0, 8000),
    tools,
    templateId: builtin?.id || a?.templateId || null,
    avatar: builtin?.avatar || a?.avatar,
    managerKey: managerKey || null,
    permissions
  };
}

function normalizeInboxLink(link, keys) {
  const fromKey = slug(link?.fromKey || link?.from || link?.fromName);
  const toKey = slug(link?.toKey || link?.to || link?.toName);
  if (!fromKey || !toKey || fromKey === toKey) return null;
  if (!keys.has(fromKey) || !keys.has(toKey)) return null;
  const kind = link?.kind === 'notify' ? 'notify' : 'delegate';
  return {
    fromKey,
    toKey,
    kind,
    note: String(link?.note || link?.label || '').trim().slice(0, 200)
  };
}

/**
 * Valida e normaliza estrutura bruta (JSON do modelo ou API).
 * @returns {{ version, title, summary, projectName, projectDescription, roles, agents, inboxLinks }}
 */
export function normalizeTeamStructure(raw, { templates = TEMPLATES } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Estrutura de time inválida.');
  const roles = (Array.isArray(raw.roles) ? raw.roles : []).slice(0, MAX_ROLES).map(normalizeRole);
  const rolesById = new Map(roles.map(r => [r.id, r]));
  for (const r of roles) rolesById.set(slug(r.name), r);

  const agents = (Array.isArray(raw.agents) ? raw.agents : []).slice(0, MAX_AGENTS).map((a, i) => normalizeAgentDraft(a, i, rolesById));
  if (!agents.length) throw new Error('Informe pelo menos um agente no time.');

  const usedKeys = new Set();
  for (const a of agents) {
    let k = a.key;
    let n = 2;
    while (usedKeys.has(k)) k = `${a.key}-${n++}`;
    a.key = k;
    usedKeys.add(k);
  }
  const keySet = usedKeys;
  const inboxLinks = (Array.isArray(raw.inboxLinks) ? raw.inboxLinks : [])
    .map(l => normalizeInboxLink(l, keySet))
    .filter(Boolean);

  return {
    version: TEAM_STRUCTURE_VERSION,
    title: String(raw.title || raw.name || 'Time proposto').trim().slice(0, 120),
    summary: String(raw.summary || raw.description || '').trim().slice(0, 500),
    projectName: String(raw.projectName || raw.project?.name || '').trim().slice(0, 120),
    projectDescription: String(raw.projectDescription || raw.project?.description || '').trim().slice(0, 500),
    roles,
    agents,
    inboxLinks
  };
}

/** Parse determinístico de brief (sem LLM). */
export function parseTeamBrief(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const jsonStr = extractJsonBlob(raw);
  if (jsonStr) {
    try {
      return normalizeTeamStructure(JSON.parse(jsonStr));
    } catch { /* tenta heurística */ }
  }

  const lines = stripTestDirective(raw).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  let title = 'Time proposto';
  const titleLine = lines.find(l => /^time\s*:/i.test(l) || /^#\s+/.test(l));
  if (titleLine) title = titleLine.replace(/^time\s*:\s*/i, '').replace(/^#\s+/, '').trim();

  const roles = [];
  const agents = [];
  const inboxLinks = [];
  let inRoles = false;

  for (const line of lines) {
    if (/^pap[eé]is?\s*:/i.test(line)) { inRoles = true; continue; }
    if (/^agentes?\s*:/i.test(line)) { inRoles = false; continue; }
    if (/^(inbox|mensagens|delega[cç][aã]o)\s*:/i.test(line)) { inRoles = false; continue; }

    const roleBullet = /^[-*•]\s*(.+?)\s*[:\u2014-]\s*(.+)$/i.exec(line);
    if (inRoles && roleBullet) {
      roles.push(normalizeRole({ name: roleBullet[1], purpose: roleBullet[2] }, roles.length));
      continue;
    }

    const agentBullet = /^[-*•]\s*(.+?)\s*[:\u2014-]\s*(.+)$/i.exec(line)
      || /^\d+[.)]\s*(.+?)\s*[:\u2014-]\s*(.+)$/i.exec(line);
    if (agentBullet && !/^time\s*:/i.test(line)) {
      agents.push(normalizeAgentDraft({ name: agentBullet[1], description: agentBullet[2] }, agents.length, new Map()));
      continue;
    }

    const inbox = /^(.+?)\s*(?:->|→|reporta para|delega para|envia para)\s*(.+?)(?:\s*[:\u2014-]\s*(.+))?$/i.exec(line);
    if (inbox) {
      inboxLinks.push({
        fromKey: slug(inbox[1]),
        toKey: slug(inbox[2]),
        kind: /notifica/i.test(line) ? 'notify' : 'delegate',
        note: inbox[3] ? String(inbox[3]).trim() : ''
      });
    }
  }

  if (!agents.length) {
    const single = lines.filter(l => !/^time\s*:/i.test(l) && !/^#/.test(l)).join(' ');
    if (single.length > 20) {
      agents.push(normalizeAgentDraft({ name: 'Coordenador', description: single.slice(0, 200), instructions: single }, 0, new Map()));
    } else return null;
  }

  const structure = normalizeTeamStructure({ title, roles, agents, inboxLinks });
  return structure;
}

export function parseTeamFromModelText(text) {
  const jsonStr = extractJsonBlob(text);
  if (!jsonStr) return null;
  try {
    return normalizeTeamStructure(JSON.parse(jsonStr));
  } catch {
    return null;
  }
}

const ROLE_CATEGORY = {
  coordinator: 'Produtividade',
  research: 'Pesquisa',
  data: 'Dados',
  dev: 'Operações',
  support: 'Atendimento',
  content: 'Marketing',
  sales: 'Vendas',
  ops: 'Operações'
};

/** Converte scaffold do Architect (#54) em estrutura persistível (team-proposals). */
export function structureFromArchitectScaffold(scaffold) {
  if (!scaffold?.agents?.length) throw new Error('Scaffold Architect sem agentes.');
  const agents = scaffold.agents.map((a, i) => ({
    key: String(a.id || slug(a.role) || `a${i}`),
    name: String(a.suggestedName || a.role).slice(0, 60),
    description: String(a.description || '').slice(0, 200),
    category: ROLE_CATEGORY[a.id] || pickCategory(`${a.role} ${a.description}`),
    tools: a.tools,
    templateId: a.templateHint || null,
    instructions: String(a.description || ''),
    managerKey: null
  }));
  const coord = agents.find(a => a.key === 'coordinator');
  if (coord && scaffold.coordination?.id === 'hub') {
    for (const a of agents) {
      if (a.key !== coord.key) a.managerKey = coord.key;
    }
  }
  const inboxLinks = [];
  if (coord && scaffold.coordination?.id === 'hub') {
    for (const a of agents) {
      if (a.key !== coord.key) {
        inboxLinks.push({ fromKey: coord.key, toKey: a.key, kind: 'delegate', note: 'Handoff do coordenador' });
      }
    }
  }
  const summary = [
    scaffold.coordination?.label,
    scaffold.coordination?.description,
    ...(scaffold.tradeoffs || []).slice(0, 2)
  ].filter(Boolean).join(' · ');
  return normalizeTeamStructure({
    title: String(scaffold.goal || 'Time Architect').slice(0, 120),
    summary: summary.slice(0, 500),
    projectName: String(scaffold.goal || '').slice(0, 80),
    roles: scaffold.agents.map(a => ({ id: a.id, name: a.role, purpose: a.description })),
    agents,
    inboxLinks
  });
}

/** Atalho: goal do Architect → estrutura normalizada (sem persistir). */
export function teamStructureFromArchitectGoal(goal, constraints) {
  return structureFromArchitectScaffold(architectSuggest({ goal, constraints }));
}

export const ORCHESTRATOR_SYSTEM = `Você projeta times de agentes para o Ripper (assistentes com ferramentas).
Responda APENAS com um JSON válido (sem markdown), no formato:
{
  "title": "string",
  "summary": "string opcional",
  "projectName": "opcional",
  "roles": [{ "id": "slug", "name": "...", "purpose": "..." }],
  "agents": [{
    "key": "slug-unico",
    "name": "...",
    "description": "...",
    "category": "uma de: ${CATEGORIES.join(', ')}",
    "instructions": "...",
    "tools": ["web","memory",...],
    "roleId": "opcional",
    "managerKey": "key do gestor (opcional, gancho futuro)",
    "permissions": { "hint": "opcional, sem enforcement" }
  }],
  "inboxLinks": [{ "fromKey": "...", "toKey": "...", "kind": "delegate|notify", "note": "..." }]
}
Use inboxLinks para quem deve receber delegações assíncronas (send_message) de quem.`;

/** Gera estrutura via modelo (em testes: RIPPER_TEST_PROVIDER=team). */
export async function orchestrateTeamStructure(brief, { settings, signal, runModel } = {}) {
  const prompt = `${ORCHESTRATOR_SYSTEM}\n\nBrief:\n${brief}\n\n[[ripper:test:team]]`;
  let out = '';
  if (runModel) {
    for await (const ev of runModel(prompt)) out += ev.text || '';
  } else if (process.env.RIPPER_TEST_PROVIDER) {
    for await (const ev of runTestProvider({ prompt, signal })) out += ev.text || '';
  } else {
    return null;
  }
  return parseTeamFromModelText(out);
}

export function listTeamProposals(db) {
  return (db.teamProposals || []).slice().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
}

export function teamProposalOr404(db, pid) {
  const p = (db.teamProposals || []).find(x => x.id === pid);
  if (!p) throw Object.assign(new Error('Proposta de time não encontrada.'), { code: 404 });
  return p;
}

export function createTeamProposal(db, { brief, structure, source = 'parse' }) {
  if (!db.teamProposals) db.teamProposals = [];
  const now = Date.now();
  const normalized = normalizeTeamStructure(structure);
  const row = {
    id: newId(),
    status: 'proposed',
    source,
    brief: String(brief || '').trim().slice(0, 8000),
    structure: normalized,
    createdAt: now,
    updatedAt: now
  };
  db.teamProposals.unshift(row);
  return row;
}

function inboxHintsForAgent(agentKey, structure) {
  const outs = structure.inboxLinks.filter(l => l.fromKey === agentKey);
  if (!outs.length) return '';
  const byKey = new Map(structure.agents.map(a => [a.key, a]));
  return outs.map(l => {
    const dest = byKey.get(l.toKey)?.name || l.toKey;
    return l.kind === 'notify'
      ? `Notifique ${dest} quando relevante (${l.note || 'sem detalhe extra'}).`
      : `Delegue trabalho assíncrono para ${dest} com send_message quando for claramente da função dele (${l.note || ''}).`.trim();
  }).join('\n');
}

function resolveManagerId(agentDraft, keyToId) {
  if (!agentDraft.managerKey) return null;
  return keyToId.get(agentDraft.managerKey) || null;
}

/**
 * Materializa agentes (e projeto opcional). Atualiza proposta para status applied.
 */
export function applyTeamProposal(db, proposalId, { createProject = true, projectName, projectDescription } = {}) {
  const proposal = teamProposalOr404(db, proposalId);
  if (proposal.status === 'applied') throw Object.assign(new Error('Este time já foi aplicado.'), { code: 409 });

  const structure = proposal.structure;
  const keyToId = new Map();
  const created = [];

  for (const draft of structure.agents) {
    const builtin = draft.templateId ? TEMPLATES.find(t => t.id === draft.templateId) : null;
    const hints = inboxHintsForAgent(draft.key, structure);
    const instructions = [draft.instructions, hints].filter(Boolean).join('\n\n');
    const a = patchAgent(newAgent({ ...(builtin || {}), templateId: builtin?.id || draft.templateId }), {
      name: draft.name,
      description: draft.description,
      category: draft.category,
      instructions,
      tools: draft.tools,
      avatar: draft.avatar,
      teamBinding: {
        proposalId: proposal.id,
        roleId: draft.roleId,
        managerKey: draft.managerKey,
        permissions: draft.permissions
      }
    });
    db.agents.push(a);
    keyToId.set(draft.key, a.id);
    created.push(a);
  }

  for (const a of created) {
    const draft = structure.agents.find(d => keyToId.get(d.key) === a.id);
    const managerId = draft ? resolveManagerId(draft, keyToId) : null;
    if (managerId && a.teamBinding) a.teamBinding.managerId = managerId;
  }

  let project = null;
  if (createProject) {
    const name = (projectName || structure.projectName || structure.title || 'Time').trim();
    project = {
      id: newId(),
      name: name.slice(0, 120),
      description: (projectDescription || structure.projectDescription || structure.summary || '').slice(0, 500),
      instructions: structure.summary || '',
      agentIds: created.map(a => a.id),
      createdAt: Date.now()
    };
    db.projects.unshift(project);
  }

  proposal.status = 'applied';
  proposal.appliedAt = Date.now();
  proposal.updatedAt = proposal.appliedAt;
  proposal.appliedAgentIds = Object.fromEntries([...keyToId.entries()]);
  if (project) proposal.projectId = project.id;

  appendAudit(db, {
    type: 'team_proposal_apply',
    proposalId: proposal.id,
    agentIds: created.map(a => a.id),
    projectId: project?.id || null
  });

  return { proposal, agents: created, project };
}
