import { effectiveAutonomyLevel, isConnectorToolAllowedByAutonomy } from './autonomy.mjs';
// Claude (assinatura via login do Claude Code, ou API key) e Codex (login ChatGPT via `codex login`).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { buildRipperBuiltinTools, ripperClaudeToolAllowlist } from './ripper-builtin-tools.mjs';
import { createRipperMcpBridge } from './ripper-mcp-bridge.mjs';
import { wantsConnectors, localClaudeCodeExtras } from './claude-connectors.mjs';
import { codexMcpConfigLines, ripperCodexMcpArgs } from './codex-mcp.mjs';
import {
  applyClaudeUsageReport, captureClaudeUsageFromQuery, claudeAuthMode
} from './claude-subscription-usage.mjs';
import { lgpdMiddlewareProviderPayload } from './lgpd-pii.mjs';

import { resolveAgentStyle, agentStyleBlock } from './agent-style.mjs';
import { isEnterpriseMode } from './enterprise.mjs';
import { spareKey, takeSpare } from './claude-prewarm.mjs';
import { PRINCIPAL, accountOrder, allAccounts, applyAccountEnv, isLimitError, markExhausted, limitResetAt } from './claude-accounts.mjs';

// Só as regras: título e link da fonte não mudam nada no comportamento e custam tokens a cada turno.
const SKILL = readFileSync(new URL('../skills/token-the-ripper.md', import.meta.url), 'utf8').split('\n').filter(l => !/^(#|Fonte:)/.test(l)).join('\n').trim();

/** Parte fixa do prompt (mesma a cada turno): entra no cache e no processo pré-aquecido. Memórias vão no contexto do turno. */
export function systemPrompt(agent, settings) {
  return systemPromptSections(agent, settings).map(s => s[1]).join('\n\n');
}

/** Seções do prompt fixo como [nome, texto] (só as que entram). Usado por scripts/prompt-size.mjs. */
export function systemPromptSections(agent, settings) {
  const has = t => agent.tools.includes(t);
  const voice = resolveAgentStyle(agent, settings);
  // Dicas de ferramenta só quando a ferramenta existe de fato neste turno (mesmas regras de ripper-builtin-tools).
  const pc = has('computer') && settings.computer.mode !== 'off' && (settings.computer.mode !== 'local' || settings.computer.allowLocalCommands);
  const names = ['identidade', 'estilo', 'instruções do agente', 'nome do usuário', 'instruções globais', 'memória', 'arquivos/entrega', 'scripts', 'rotinas', 'social', 'web vs navegador', 'navegador', 'rede do time', 'computador', 'x9', 'conectores', 'skill token-the-ripper'];
  return [
    `Você é ${agent.name}${agent.nickname ? ` (apelido: ${agent.nickname})` : ''}, um agente do Ripper.${agent.description ? ` Função: ${agent.description}` : ''}`,
    agentStyleBlock(voice),
    agent.instructions,
    settings.name && `O usuário se chama ${settings.name}.`,
    settings.customInstructions,
    has('memory') && 'Para lembrar algo durável, use a ferramenta remember.',
    pc && 'Arquivo pronto para o usuário (Word, Excel, PDF, imagem…): entregue com deliver_file; nunca mande caminho, porta ou link localhost. Bibliotecas python-docx, openpyxl, pandas, reportlab e python-pptx (slides) já estão instaladas.',
    pc && 'Antes de escrever um script, procure com find_script; quando um script seu funcionar, guarde com save_script (tarefa descrita em termos gerais).',
    has('routines') && 'Para agendar algo recorrente, use schedule_routine.',
    has('social') && settings.flags?.socialWebhooks && settings.social?.webhooks?.some(h => h.enabled !== false && h.url)
      && 'Para publicar em canais configurados (webhook), use post_social ou send_webhook. draft=true só rascunha. Não invente métricas de engajamento.',
    has('web') && (has('browser') || has('computer')) && 'Para ler ou pesquisar na web, use WebSearch/WebFetch: é muito mais rápido e barato. O navegador e o computador só quando precisar clicar, logar ou preencher algo. Tarefas independentes (ex.: pesquisar e montar planilha) podem rodar na mesma rodada de ferramentas.',
    has('browser') && settings.computer.mode === 'docker' && 'Você tem um navegador próprio (browser_open, browser_click, browser_type, browser_scroll, browser_read). O usuário vê a sua tela. Nunca digite senhas nem finalize compras sem o usuário pedir.',
    has('computer') && settings.computer.mode === 'docker' && `Seu computador está na rede do time: cada colega é alcançável pelo nome em minúsculas (ex.: http://${agent.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}:3000 é você). A pasta /shared é comum a todos os agentes: use para trocar arquivos.`,
    pc && 'Você tem um computador próprio: use computer_exec e computer_share. Arquivos enviados ficam em ./uploads.',
    agent.templateId === 'x9-auditor' && isEnterpriseMode(settings) && 'Modo auditor X9: use x9_context e x9_checklist antes de recomendar mudanças. Não execute ações destrutivas nem altere settings.',
    'Conectores que pedem login ou autorização: só comente se o pedido depender deles. Fora isso, não fale de conectores.',
    SKILL
  ].map((t, i) => [names[i], t]).filter(s => s[1]);
}

/** holder: processo pré-aquecido — as ferramentas executam com o ctx do turno atual (holder.ctx), não o do aquecimento. */
function builtinTools(agent, ctx, holder) {
  const defs = buildRipperBuiltinTools(agent, ctx);
  const run = d => holder
    ? (...a) => buildRipperBuiltinTools(agent, holder.ctx).find(t => t.name === d.name).execute(...a)
    : d.execute;
  return createSdkMcpServer({
    name: 'ripper',
    version: '1.0.0',
    tools: defs.map(d => tool(d.name, d.description, d.inputSchema, run(d)))
  });
}

/** Headers HTTP para plugin MCP (inclui Bearer OAuth e chave API quando houver). */
export function mcpPluginHttpHeaders(plugin) {
  const h = { ...(plugin.headers || {}) };
  if (plugin.auth?.apiKey) {
    const headerName = plugin.auth.apiKeyHeader || 'authorization';
    if (!h[headerName] && !h[headerName.toLowerCase()]) {
      const key = String(plugin.auth.apiKey);
      if (/^vlt_/.test(key)) {
        // Ainda não resolvido — turn() deve passar plugins já resolvidos.
        h[headerName] = key;
      } else {
        h[headerName] = plugin.auth.apiKeyPrefix === 'raw' ? key : `Bearer ${key}`;
      }
    }
  }
  const tok = plugin.auth?.oauth?.accessToken;
  if (tok && !h.authorization && !h.Authorization) {
    const prefix = plugin.auth.oauth.tokenType?.toLowerCase() === 'bearer' ? 'Bearer' : (plugin.auth.oauth.tokenType || 'Bearer');
    h.authorization = `${prefix} ${tok}`;
  }
  return h;
}

export function userMcp(agent, plugins) {
  if (!agent.tools.includes('plugins')) return {};
  return Object.fromEntries(plugins.filter(p => p.enabled !== false).map(p => [p.name,
    p.type === 'http' ? { type: 'http', url: p.url, headers: mcpPluginHttpHeaders(p) } : { type: 'stdio', command: p.command, args: p.args || [], ...(p.env ? { env: { ...process.env, ...p.env } } : {}) }]));
}

/** Rótulo + detalhe curto para a linha do tempo de ferramentas (ripper builtin ou Codex). */
export function describeRipperTool(name, input = {}) {
  const n = String(name).replace(/^mcp__ripper__/, '');
  const d = { browser_open: input.url, browser_click: input.target, browser_type: input.target && `${input.target}${input.submit ? ' ↵' : ''}`, send_message: input.to && `→ ${input.to}${input.priority === 'now' ? ' (urgente)' : ''}`, call_agent: input.to && `↔ ${input.to}`, save_artifact: input.title, read_artifact: input.title, use_skill: input.name, list_skills: 'listar', save_skill: input.name, computer_exec: input.command, computer_share: input.port && `porta ${input.port}`, WebSearch: input.query, WebFetch: input.url, remember: input.text, schedule_routine: input.name, post_social: input.webhookId && `→ ${input.webhookId}`, send_webhook: input.webhookId && `→ ${input.webhookId}`, list_social_webhooks: 'listar' }[n];
  return { tool: n, detail: d ? String(d).slice(0, 160) : undefined };
}

/** Converte uma linha JSON do `codex exec --json` em evento de UI (testável sem CLI). */
export function parseCodexJsonEvent(e) {
  const item = e.item || e.msg;
  if (!item) return null;
  if (item.type === 'agent_message' && item.text) return { text: item.text };
  // shell do próprio Codex (sandbox dele), não o Computador do Ripper: não dizer "no computador"
  if (item.type === 'command_execution') return { tool: 'shell', detail: item.command?.slice?.(0, 160) };
  if (item.type === 'mcp_tool_call' && item.server === 'ripper' && item.status === 'in_progress') {
    const args = item.arguments && typeof item.arguments === 'object' ? item.arguments : {};
    return describeRipperTool(item.tool, args);
  }
  return null;
}

// Sem telemetria nem checagem de atualização a cada turno: a 1ª palavra sai em ~1–2s em vez de ~5s
// (medido em 04/10/2026). Conectores do claude.ai e o uso da assinatura continuam funcionando.
export const CLAUDE_FAST_ENV = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1' };

/**
 * Turno no Claude pela conta do agente (ou a padrão). Se a assinatura bater o limite antes de responder,
 * tenta a próxima conta logada (ex.: Pro → Teams) e avisa no chat.
 */
export async function* runClaude(args) {
  const order = args.settings.claude.mode === 'api' ? [PRINCIPAL] : accountOrder(args.settings, args.agent);
  const label = id => allAccounts(args.settings).find(a => a.id === id)?.label || id;
  for (let i = 0; i < order.length; i++) {
    let answered = false;
    try {
      for await (const ev of runClaudeAccount({ ...args, account: order[i] })) { if (ev.text || ev.tool) answered = true; yield ev; }
      return;
    } catch (e) {
      if (answered || args.signal?.aborted || !isLimitError(e) || args.settings.claude.mode === 'api') throw e;
      markExhausted(order[i], limitResetAt(e));
      if (i === order.length - 1) throw e;
      yield { warn: `A conta "${label(order[i])}" do Claude bateu o limite. Continuando pela conta "${label(order[i + 1])}".` };
    }
  }
}

async function* runClaudeAccount({ agent, model, effort, prompt, images = [], history, system, systemStable, settings, ctx, signal, account }) {
  ({ prompt, history, system } = lgpdMiddlewareProviderPayload({ prompt, history, system }, settings));
  // Prefixo fixo intacto (a LGPD não mascarou nada nele) → dá para usar o processo pré-aquecido.
  const append = systemStable && system.startsWith(systemStable) ? system.slice(systemStable.length).trim() : null;
  const env = { ...process.env, ...CLAUDE_FAST_ENV };
  if (settings.claude.mode === 'api' && settings.claude.apiKey) env.ANTHROPIC_API_KEY = settings.claude.apiKey;
  else { delete env.ANTHROPIC_API_KEY; applyAccountEnv(env, account); } // login da assinatura (conta escolhida)

  const web = agent.tools.includes('web');
  const transcript = history.map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`).join('\n\n');
  const textPrompt = transcript ? `${transcript}\n\nUsuário: ${prompt}` : prompt;
  const subscriptionMode = claudeAuthMode(settings, env);
  const canConnect = settings.claude.useConnectors && agent.tools.includes('plugins');
  // Conectores custam 3–5s para abrir: de saída só se o pedido parece precisar; senão, sob demanda (use_connectors).
  let connectors = canConnect && wantsConnectors(`${prompt}\n${history.slice(-2).map(m => m.content).join('\n')}`);
  for (;;) {
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let wantMore = false;
    const turnCtx = canConnect && !connectors ? { ...ctx, loadConnectors: () => { wantMore = true; abortController.abort(); } } : ctx;
    const allowedTools = claudeAllowedTools(agent, settings, turnCtx);
    const userPrompt = () => images.length ? (async function* () {
      yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
        { type: 'text', text: textPrompt },
        ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } }))
      ] } };
    })() : textPrompt;
    let warm = null;
    if (append !== null && effort !== 'max') { // 'max' não existe no ajuste do claim
      const key = spareKey([agent.id, systemStable, allowedTools, userMcp(agent, settings.plugins), web, connectors, settings.claude.mode, account, settings.claude.apiKey && spareKey([settings.claude.apiKey])]);
      warm = await takeSpare(key, () => {
        const holder = { ctx: turnCtx };
        const opts = buildClaudeQueryOptions({ agent, model, system: systemStable, settings, ctx: turnCtx, holder, web, env, connectors });
        delete opts.abortController;
        return { holder, options: { ...opts, allowedTools } };
      }, agent.id);
    }
    const cold = () => query({ prompt: userPrompt(), options: { ...buildClaudeQueryOptions({ agent, model, effort, system, settings, ctx: turnCtx, web, env, abortController, connectors }), allowedTools } });
    let q;
    if (warm) {
      warm.holder.ctx = turnCtx;
      if (process.env.RIPPER_DEBUG_PREWARM) warm.spare.claimed.then(() => console.log('[prewarm] claim ok'), e => console.log('[prewarm] recusado:', e.message));
      q = warm.spare.claim({ prompt: userPrompt(), options: {
        cwd: process.cwd(), model, appendSystemPrompt: append || undefined,
        // esforço baixo = responder direto: sem pensar antes e sem a ida e volta extra do ajuste de esforço
        ...(effort === 'low' ? { maxThinkingTokens: 0 } : effort && effort !== 'auto' ? { settings: { effortLevel: effort } } : {})
      } });
      abortController.signal.addEventListener('abort', () => q.close(), { once: true });
    } else q = cold();
    let output = false;
    const tq = Date.now(), seen = new Set(); // RIPPER_DEBUG_PREWARM: linha do tempo até a 1ª palavra
    try {
      for await (const m of claimOrCold(q, warm, cold, () => output)) {
        if (process.env.RIPPER_DEBUG_PREWARM) { const k = m.type + ':' + (m.subtype || m.event?.type || ''); if (!seen.has(k)) { seen.add(k); console.log('[tempo]', Date.now() - tq, 'ms', k); } }
        if (m.type !== 'system') output = true;
        if (m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') yield { text: m.event.delta.text };
        else if (m.type === 'assistant') {
          if (subscriptionMode === 'subscription' && m.usage_report && ctx?.db) {
            applyClaudeUsageReport(ctx.db, m.usage_report, account);
          }
          for (const b of m.message.content) if (b.type === 'tool_use') yield describeRipperTool(b.name, b.input);
        } else if (m.type === 'result') {
          if (subscriptionMode !== 'subscription' && m.total_cost_usd > 0) yield { cost: m.total_cost_usd }; // API key: custo real em US$
          // o texto real vem em result (ex.: "You've hit your session limit · resets 5:20pm"); subtype sozinho não diz nada
          if (m.is_error) throw new Error(m.result || m.errors?.join('; ') || `${m.subtype}: erro`);
        }
      }
    } catch (e) {
      if (!wantMore) throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (!wantMore && subscriptionMode === 'subscription' && ctx?.db) {
        await captureClaudeUsageFromQuery(q, ctx.db, settings, account);
      }
    }
    if (!wantMore || signal?.aborted) return;
    connectors = true; // recomeça o turno, agora com os conectores
  }
}

/** Mensagens do processo pré-aquecido; se ele recusar antes de responder, roda o turno do jeito normal. */
async function* claimOrCold(q, warm, cold, answered) {
  if (!warm) return yield* q;
  let refused = false;
  for await (const m of q) {
    if (m.type === 'result' && m.is_error && /^not_claimed/.test(m.result || m.errors?.[0] || '') && !answered()) { refused = true; break; }
    yield m;
  }
  const why = await warm.spare.claimed.then(() => null, e => e);
  if (!refused && (!why || answered() || /^option_not_applied/.test(why.message))) return;
  warm.spare.close();
  yield* cold();
}

// Codex CLI usa o login do ChatGPT (`codex login`). MCPs via -c (stdio e HTTP).
const CODEX_EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

const hasTool = (agent, name) => agent.tools.includes(name);

/** Opções do Claude SDK (testável sem chamar query). */
export function buildClaudeQueryOptions({ agent, model, effort, system, settings, ctx, holder, web, env, abortController, connectors = settings.claude.useConnectors && agent.tools.includes('plugins'), localExtras = connectors ? localClaudeCodeExtras() : null }) {
  // settingSources ['user'] traz também MCPs/plugins do Claude Code da máquina. Tiramos do contexto
  // (o agente tentava, era negado e falava em "ferramenta bloqueada"); canUseTool fica como rede de segurança.
  const ripperServers = Object.keys(userMcp(agent, settings.plugins));
  const hide = (localExtras?.mcpServers || []).filter(n => !ripperServers.includes(n));
  return {
    ...(hide.length ? { disallowedTools: hide.map(n => `mcp__${n.replace(/[^\w-]/g, '_')}`) } : {}),
    ...(localExtras?.plugins?.length ? { settings: { enabledPlugins: Object.fromEntries(localExtras.plugins.map(k => [k, false])) } } : {}),
    model, env, abortController,
    ...(effort === 'low' ? { maxThinkingTokens: 0 } : effort && effort !== 'auto' ? { effort } : {}),
    systemPrompt: system,
    mcpServers: { ripper: builtinTools(agent, ctx, holder), ...userMcp(agent, settings.plugins) },
    settingSources: connectors ? ['user'] : [],
    tools: web ? ['WebSearch', 'WebFetch'] : [],
    // 'dontAsk' negava em silêncio tudo fora do allowedTools — inclusive os conectores do claude.ai
    // (Google Agenda, Gmail…), cujos nomes só aparecem na hora. Agora decidimos por chamada.
    permissionMode: 'default',
    canUseTool: async (toolName, input) => connectorToolAllowed(toolName, agent, settings)
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'Este recurso não está disponível agora. Siga sem ele; não cite nomes de ferramentas ao usuário.' },
    includePartialMessages: true
  };
}

/** Lista de allowedTools passada ao Claude SDK (testável sem rede). */
export function claudeAllowedTools(agent, settings, ctx) {
  const web = agent.tools.includes('web');
  return [
    ...ripperClaudeToolAllowlist(agent, ctx),
    ...Object.keys(userMcp(agent, settings.plugins)).flatMap(name => effectiveAutonomyLevel(agent, settings) === 'read_only'
      ? (settings.plugins.find(p => p.name === name)?.readOnlyTools || []).map(t => `mcp__${name}__${t}`)
      : [`mcp__${name}__*`]),
    ...(web ? ['WebSearch', 'WebFetch'] : [])
  ];
}

/** Argumentos do spawn codex exec (testável sem CLI real). */
export function buildCodexSpawnArgs({ agent, effort, settings, images = [], ripperMcpBridge }) {
  const localComputer = agent.tools.includes('computer') && settings.computer.mode === 'local' && settings.computer.allowLocalCommands;
  const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', localComputer ? 'workspace-write' : 'read-only'];
  if (CODEX_EFFORT[effort]) args.push('-c', `model_reasoning_effort="${CODEX_EFFORT[effort]}"`);
  for (const i of images) args.push('-i', i.path);
  if (ripperMcpBridge) args.push(...ripperCodexMcpArgs(ripperMcpBridge));
  if (agent.tools.includes('plugins')) {
    const readOnly = effectiveAutonomyLevel(agent, settings) === 'read_only';
    for (const p of settings.plugins.filter(p => p.enabled !== false)) {
      // Somente leitura: só as ferramentas com readOnlyHint (enabled_tools); conector sem nenhuma fica de fora.
      if (readOnly && !p.readOnlyTools?.length) continue;
      if (readOnly) args.push('-c', `mcp_servers.${p.name}.enabled_tools=${JSON.stringify(p.readOnlyTools)}`);
      if (p.type === 'http') args.push(...codexMcpConfigLines(p.name, { url: p.url, headers: mcpPluginHttpHeaders(p) }));
      else args.push(...codexMcpConfigLines(p.name, { command: p.command, args: p.args || [], env: p.env }));
    }
  }
  return args;
}

/** No Windows o codex roda pelo cmd (shim .cmd), que quebra argumentos nos espaços: aspas em volta de cada um que precisar. */
export const shellArgs = (args, win = process.platform === 'win32') =>
  win ? args.map(a => /[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a) : args;

export async function* runCodex({ agent, effort, prompt, images = [], history, system, settings, cwd, ctx, signal }) {
  ({ prompt, history, system } = lgpdMiddlewareProviderPayload({ prompt, history, system }, settings));
  const bridge = ctx ? await createRipperMcpBridge(agent, ctx) : null;
  const args = buildCodexSpawnArgs({ agent, effort, settings, images, ripperMcpBridge: bridge });
  const full = `${system}\n\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nuser: ${prompt}`;
  const child = spawn('codex', shellArgs([...args, '-']), { cwd, shell: process.platform === 'win32' });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.end(full);
  signal?.addEventListener('abort', () => child.kill(), { once: true });
  let buf = '', err = '';
  child.stderr.on('data', d => err += d);
  const done = new Promise(r => child.on('close', r));
  try {
    for await (const chunk of child.stdout) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const ev = parseCodexJsonEvent(JSON.parse(line));
          if (ev) yield ev;
        } catch {}
      }
    }
    if (await done) throw new Error('codex: ' + (err.slice(-400).trim() || 'não respondeu. Rode `codex login` nesta máquina.'));
  } finally {
    if (bridge) await bridge.close().catch(() => {});
  }
}

/**
 * Chamadas que chegam ao canUseTool (o resto já está no allowedTools):
 * conectores da conta claude.ai do usuário — só para agente com "plugins" e a opção ligada.
 * Plugins locais do Claude Code da máquina (ex.: mcp__inspo__…) ficam de fora: não são do Ripper.
 */
export function connectorToolAllowed(toolName, agent, settings) {
  const name = String(toolName || '');
  // Conectores claude.ai: sem annotations visíveis aqui, então somente leitura bloqueia todos.
  if (name.startsWith('mcp__claude_ai_')) return !!settings?.claude?.useConnectors && agent.tools.includes('plugins') && effectiveAutonomyLevel(agent, settings) !== 'read_only';
  const server = name.split('__')[1];
  return name.startsWith('mcp__') && !!server && Object.keys(userMcp(agent, settings?.plugins || [])).includes(server)
    && isConnectorToolAllowedByAutonomy(agent, settings, server, name.slice(`mcp__${server}__`.length));
}

/** Descreve uma imagem em poucas frases (Haiku, o mais econômico). Usado em imagens recebidas no WhatsApp. */
export async function describeImage({ data, mediaType, settings }) {
  const env = { ...process.env, ...CLAUDE_FAST_ENV };
  if (settings.claude?.mode === 'api' && settings.claude.apiKey) env.ANTHROPIC_API_KEY = settings.claude.apiKey;
  else { delete env.ANTHROPIC_API_KEY; applyAccountEnv(env, settings.claude?.defaultAccount); }
  const prompt = (async function* () {
    yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
      { type: 'text', text: 'Descreva esta imagem em português em até 3 frases. Transcreva qualquer texto visível (preços, endereços, nomes).' },
      { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
    ] } };
  })();
  let out = '';
  for await (const m of query({ prompt, options: { model: 'claude-haiku-5-5', tools: [], settingSources: [], env, systemPrompt: 'Você descreve imagens de forma objetiva e curta.' } })) {
    if (m.type === 'result' && !m.is_error) out = m.result || '';
  }
  return out.trim();
}
