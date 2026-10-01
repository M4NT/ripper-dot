import { findScriptTool, saveScript } from './script-pool.mjs';
import { z } from 'zod';
import { isEnterpriseMode } from './enterprise.mjs';
import { isToolAllowedByAutonomy } from './autonomy.mjs';
import { isFlagEnabled } from './feature-flags.mjs';

const text = t => ({ content: [{ type: 'text', text: String(t) }] });

/** Metadados estáticos (compartilhados com o MCP stdio do Codex). */
export const RIPPER_TOOL_CATALOG = {
  send_message: {
    description: 'Manda uma tarefa ou pergunta para outro agente, que trabalha nela de forma independente. A resposta volta para esta conversa quando ficar pronta; não espere por ela. Só use quando o colega for claramente o mais indicado.',
    inputSchema: {
      to: z.string().describe('Nome exato do colega'),
      message: z.string().max(4000).describe('Pedido completo e autossuficiente: o colega não vê esta conversa'),
      priority: z.enum(['now', 'normal', 'low']).optional()
    }
  },
  call_agent: {
    description: 'Chama outro agente e espera a resposta na hora (síncrono). Use quando precisar do resultado agora para continuar. Se o colega pode demorar ou estiver ocupado, prefira send_message.',
    inputSchema: {
      to: z.string().describe('Nome exato do colega'),
      message: z.string().max(4000).describe('Pedido completo e autossuficiente: o colega não vê esta conversa'),
      timeout_seconds: z.number().min(5).max(300).optional().describe('Quanto esperar (padrão das configurações, até 300s)')
    }
  },
  browser_open: { description: 'Abre um endereço no navegador do agente.', inputSchema: { url: z.string() } },
  browser_click: { description: 'Clica num link ou botão, pelo texto visível ou seletor CSS.', inputSchema: { target: z.string() } },
  browser_type: { description: 'Digita num campo (texto visível, placeholder ou seletor). submit=true aperta Enter.', inputSchema: { target: z.string(), text: z.string(), submit: z.boolean().optional() } },
  browser_scroll: { description: 'Rola a página (dy positivo desce).', inputSchema: { dy: z.number().optional() } },
  browser_read: { description: 'Lê a página atual de novo.', inputSchema: {} },
  save_artifact: {
    description: 'Salva (ou atualiza, pelo mesmo título) uma entrega durável: roteiro, plano, texto final, tabela. Use para o que o usuário ou o time vão reaproveitar.',
    inputSchema: {
      title: z.string().max(120),
      content: z.string().max(60000),
      kind: z.enum(['documento', 'roteiro', 'plano', 'post', 'codigo', 'tabela', 'outro']).optional()
    }
  },
  read_artifact: { description: 'Lê o conteúdo completo de um artefato do time pelo título.', inputSchema: { title: z.string() } },
  use_skill: { description: 'Carrega as instruções completas de uma skill pelo nome.', inputSchema: { name: z.string() } },
  list_skills: { description: 'Lista skills disponíveis (banco + skills/ do repositório + ~/.cursor/skills-cursor).', inputSchema: {} },
  save_skill: {
    description: 'Cria ou atualiza uma skill: um passo a passo reutilizável que funcionou bem.',
    inputSchema: { name: z.string().max(60), description: z.string().max(200), content: z.string().max(20000) }
  },
  remember: {
    description: 'Guarda algo para conversas futuras. tier "profile": fato estável sobre o usuário (preferência, contexto, quem é). tier "log": o que aconteceu ou foi decidido (fica datado).',
    inputSchema: { text: z.string().max(500), tier: z.enum(['profile', 'log']).optional() }
  },
  schedule_routine: {
    description: 'Cria rotina recorrente. everyMinutes OU dailyAt "HH:MM" (+ weekday 0-6).',
    inputSchema: {
      name: z.string(),
      prompt: z.string(),
      everyMinutes: z.number().min(5).optional(),
      dailyAt: z.string().regex(/^\d\d:\d\d$/).optional(),
      weekday: z.number().min(0).max(6).optional()
    }
  },
  computer_exec: { description: 'Roda um comando shell no computador do agente.', inputSchema: { command: z.string() } },
  find_script: {
    description: 'Procura no pool compartilhado um script que já funcionou para uma tarefa parecida. Use ANTES de escrever um script do zero.',
    inputSchema: { task: z.string().max(200) }
  },
  save_script: {
    description: 'Guarda no pool um script que acabou de FUNCIONAR, para qualquer agente reaproveitar. Descreva a tarefa em termos gerais (sem dados do cliente).',
    inputSchema: { task: z.string().max(200), lang: z.string().max(20).optional(), code: z.string().max(20000), notes: z.string().max(500).optional() }
  },
  computer_share: { description: 'Gera link público para uma porta do computador.', inputSchema: { port: z.number() } },
  list_social_webhooks: {
    description: 'Lista webhooks sociais configurados (nome e id). Não mostra URLs.',
    inputSchema: {}
  },
  post_social: {
    description: 'Publica texto em um webhook configurado (Slack incoming, HTTP genérico). Corpo JSON { text }. Use draft=true para só rascunhar sem enviar.',
    inputSchema: {
      webhookId: z.string().describe('id ou nome do webhook em Conectores'),
      text: z.string().max(8000),
      draft: z.boolean().optional()
    }
  },
  send_webhook: {
    description: 'Alias de post_social: envia { text } ao webhook configurado.',
    inputSchema: {
      webhookId: z.string().describe('id ou nome do webhook'),
      text: z.string().max(8000),
      draft: z.boolean().optional()
    }
  },
  x9_context: { description: 'Coleta somente leitura: settings, auditoria recente, sandbox derivado e APIs indisponíveis.', inputSchema: {} },
  x9_checklist: { description: 'Executa o checklist determinístico X9 e devolve findings com severidade e remediação.', inputSchema: {} }
};

const SOCIAL_TOOL_NAMES = ['list_social_webhooks', 'post_social', 'send_webhook'];

function socialToolsEnabled(agent, ctx) {
  if (!ctx.social) return false;
  const hooks = ctx.social.webhooks;
  return agent.tools.includes('social') && Array.isArray(hooks) && hooks.some(h => h.enabled !== false && h.url);
}

function enabledToolNames(agent, ctx) {
  const { computer, browser, remember, scheduleRoutine, artifacts, skills, inbox, x9 } = ctx;
  const has = t => agent.tools.includes(t);
  const names = [];
  if (x9 && agent.templateId === 'x9-auditor' && isEnterpriseMode(ctx.settings || {})) names.push('x9_context', 'x9_checklist');
  if (inbox) names.push('send_message', 'call_agent');
  if (socialToolsEnabled(agent, ctx)) names.push(...SOCIAL_TOOL_NAMES);
  if (browser) names.push('browser_open', 'browser_click', 'browser_type', 'browser_scroll', 'browser_read');
  if (artifacts) names.push('save_artifact', 'read_artifact');
  if (skills) names.push('use_skill', 'list_skills', 'save_skill');
  if (has('memory')) names.push('remember');
  if (has('routines')) names.push('schedule_routine');
  if (computer && has('computer')) names.push('computer_exec', 'computer_share', 'find_script', 'save_script');
  return names.filter(n => isToolAllowedByAutonomy(agent, n, ctx.settings));
}

/** Nomes das ferramentas builtin que entrariam no contexto do agente (sem ctx de execução). */
export function listRipperBuiltinToolNames(agent, settings = {}) {
  const has = t => agent.tools.includes(t);
  const docker = settings.computer?.mode === 'docker';
  const localComputer = settings.computer?.mode === 'local' && settings.computer?.allowLocalCommands;
  const names = [];
  if (agent.templateId === 'x9-auditor') names.push('x9_context', 'x9_checklist');
  names.push('send_message', 'call_agent', 'save_artifact', 'read_artifact', 'use_skill', 'list_skills', 'save_skill');
  if (has('browser') && docker) names.push('browser_open', 'browser_click', 'browser_type', 'browser_scroll', 'browser_read');
  if (has('memory')) names.push('remember');
  if (has('routines')) names.push('schedule_routine');
  if (has('computer') && (docker || localComputer)) names.push('computer_exec', 'computer_share', 'find_script', 'save_script');
  const hookCount = (settings.social?.webhooks || []).filter(h => h.enabled !== false && h.url).length;
  if (has('social') && hookCount && isFlagEnabled(settings, 'socialWebhooks')) names.push(...SOCIAL_TOOL_NAMES);
  return names.filter(n => isToolAllowedByAutonomy(agent, n, settings));
}

/** Tamanho aproximado dos schemas das ferramentas Ripper (chars JSON), para contexto medido. */
export function ripperBuiltinSchemaChars(agent, settings = {}) {
  const names = listRipperBuiltinToolNames(agent, settings);
  return names.reduce((n, name) => n + JSON.stringify(RIPPER_TOOL_CATALOG[name] || '').length, 0);
}

function makeExecute(name, agent, ctx) {
  const { computer, browser, remember, scheduleRoutine, artifacts, skills, inbox, x9 } = ctx;
  switch (name) {
    case 'x9_context': return async () => text(x9.context());
    case 'x9_checklist': return async () => text(x9.checklist());
    case 'send_message': return async a => text(inbox.send(a));
    case 'call_agent': return async a => text(await inbox.call(a));
    case 'browser_open': return async a => text(await browser.open(a.url));
    case 'browser_click': return async a => text(await browser.click(a.target));
    case 'browser_type': return async a => text(await browser.type(a.target, a.text, a.submit));
    case 'browser_scroll': return async a => text(await browser.scroll(a.dy));
    case 'browser_read': return async () => text(await browser.read());
    case 'save_artifact': return async a => text(await artifacts.save(a));
    case 'read_artifact': return async a => text(await artifacts.read(a.title));
    case 'use_skill': return async a => text(skills.use(a.name));
    case 'list_skills': return async () => text(skills.list());
    case 'save_skill': return async a => text(skills.save(a));
    case 'remember': return async a => { await remember(a.text, a.tier); return text('ok'); };
    case 'schedule_routine': return async a => (scheduleRoutine(a), text('rotina criada'));
    case 'computer_exec': return async a => text(await computer.exec(a.command));
    case 'computer_share': return async a => text(await computer.share(a.port));
    case 'find_script': return async a => text(findScriptTool(a.task));
    case 'save_script': return async a => text(saveScript(a, agent.id));
    case 'list_social_webhooks': return async () => text(ctx.social.list());
    case 'post_social':
    case 'send_webhook': return async a => text(await ctx.social.post(a));
    default: throw new Error(`ferramenta desconhecida: ${name}`);
  }
}

/**
 * Definições das ferramentas builtin do Ripper (compartilhadas entre Claude SDK e MCP stdio do Codex).
 */
export function buildRipperBuiltinTools(agent, ctx) {
  return enabledToolNames(agent, ctx).map(name => ({
    name,
    ...RIPPER_TOOL_CATALOG[name],
    execute: makeExecute(name, agent, ctx)
  }));
}

/** Nomes no formato allowedTools do Claude SDK (`mcp__ripper__*`). */
export function ripperClaudeToolAllowlist(agent, ctx) {
  return buildRipperBuiltinTools(agent, ctx).map(t => `mcp__ripper__${t.name}`);
}
