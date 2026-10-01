import { memoryContext } from './agent-flow.mjs';
// Claude (assinatura via login do Claude Code, ou API key) e Codex (login ChatGPT via `codex login`).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { buildRipperBuiltinTools, ripperClaudeToolAllowlist } from './ripper-builtin-tools.mjs';
import { createRipperMcpBridge } from './ripper-mcp-bridge.mjs';
import { codexMcpConfigLines, ripperCodexMcpArgs } from './codex-mcp.mjs';
import {
  applyClaudeUsageReport, captureClaudeUsageFromQuery, claudeAuthMode
} from './claude-subscription-usage.mjs';
import { lgpdMiddlewareProviderPayload } from './lgpd-pii.mjs';

import { resolveAgentStyle, agentStyleBlock } from './agent-style.mjs';

const SKILL = readFileSync(new URL('../skills/token-the-ripper.md', import.meta.url), 'utf8');

export function systemPrompt(agent, settings, memories) {
  const has = t => agent.tools.includes(t);
  const voice = resolveAgentStyle(agent, settings);
  return [
    `Você é ${agent.name}, um agente do Ripper.${agent.description ? ` Função: ${agent.description}` : ''}`,
    agentStyleBlock(voice),
    agent.instructions,
    settings.name && `O usuário se chama ${settings.name}.`,
    settings.customInstructions,
    memoryContext(memories, settings.memoryLogInContext ?? 10),
    has('memory') && 'Para lembrar algo durável, use a ferramenta remember.',
    has('routines') && 'Para agendar algo recorrente, use schedule_routine.',
    has('social') && settings.flags?.socialWebhooks && (settings.social?.webhooks?.length
      ? 'Para publicar em canais configurados (webhook), use post_social ou send_webhook. draft=true só rascunha. Não invente métricas de engajamento.'
      : 'Publicação social via webhook está desligada até configurar Conectores → Webhooks sociais.'),
    has('browser') && settings.computer.mode === 'docker' && 'Você tem um navegador próprio (browser_open, browser_click, browser_type, browser_scroll, browser_read). O usuário vê a sua tela. Nunca digite senhas nem finalize compras sem o usuário pedir.',
    has('computer') && settings.computer.mode === 'docker' && `Seu computador está na rede do time: cada colega é alcançável pelo nome em minúsculas (ex.: http://${agent.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}:3000 é você). A pasta /shared é comum a todos os agentes: use para trocar arquivos.`,
    has('computer') && settings.computer.mode !== 'off' && (settings.computer.mode !== 'local' || settings.computer.allowLocalCommands) && 'Você tem um computador próprio: use computer_exec e computer_share. Arquivos enviados ficam em ./uploads.',
    SKILL
  ].filter(Boolean).join('\n\n');
}

function builtinTools(agent, ctx) {
  const defs = buildRipperBuiltinTools(agent, ctx);
  return createSdkMcpServer({
    name: 'ripper',
    version: '1.0.0',
    tools: defs.map(d => tool(d.name, d.description, d.inputSchema, d.execute))
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
    p.type === 'http' ? { type: 'http', url: p.url, headers: mcpPluginHttpHeaders(p) } : { type: 'stdio', command: p.command, args: p.args || [] }]));
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
  if (item.type === 'command_execution') return { tool: 'computer_exec', detail: item.command?.slice?.(0, 160) };
  if (item.type === 'mcp_tool_call' && item.server === 'ripper' && item.status === 'in_progress') {
    const args = item.arguments && typeof item.arguments === 'object' ? item.arguments : {};
    return describeRipperTool(item.tool, args);
  }
  return null;
}

export async function* runClaude({ agent, model, effort, prompt, images = [], history, system, settings, ctx, signal }) {
  ({ prompt, history, system } = lgpdMiddlewareProviderPayload({ prompt, history, system }, settings));
  const abortController = new AbortController();
  signal?.addEventListener('abort', () => abortController.abort(), { once: true });
  const env = { ...process.env };
  if (settings.claude.mode === 'api' && settings.claude.apiKey) env.ANTHROPIC_API_KEY = settings.claude.apiKey;
  else delete env.ANTHROPIC_API_KEY; // força o login da assinatura do Claude Code

  const web = agent.tools.includes('web');
  const transcript = history.map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`).join('\n\n');
  const textPrompt = transcript ? `${transcript}\n\nUsuário: ${prompt}` : prompt;
  const allowedTools = claudeAllowedTools(agent, settings, ctx);
  const options = buildClaudeQueryOptions({ agent, model, effort, system, settings, ctx, web, env, abortController });
  const q = query({
    prompt: images.length ? (async function* () {
      yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
        { type: 'text', text: textPrompt },
        ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } }))
      ] } };
    })() : textPrompt,
    options: { ...options, allowedTools }
  });
  const subscriptionMode = claudeAuthMode(settings, env);
  try {
    for await (const m of q) {
      if (m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') yield { text: m.event.delta.text };
      else if (m.type === 'assistant') {
        if (subscriptionMode === 'subscription' && m.usage_report && ctx?.db) {
          applyClaudeUsageReport(ctx.db, m.usage_report);
        }
        for (const b of m.message.content) if (b.type === 'tool_use') yield describeRipperTool(b.name, b.input);
      } else if (m.type === 'result' && m.is_error) throw new Error(m.subtype + ': ' + (m.errors?.join('; ') || 'erro'));
    }
  } finally {
    if (subscriptionMode === 'subscription' && ctx?.db) {
      await captureClaudeUsageFromQuery(q, ctx.db, settings);
    }
  }
}

// Codex CLI usa o login do ChatGPT (`codex login`). MCPs via -c (stdio e HTTP).
const CODEX_EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

const hasTool = (agent, name) => agent.tools.includes(name);

/** Opções do Claude SDK (testável sem chamar query). */
export function buildClaudeQueryOptions({ agent, model, effort, system, settings, ctx, web, env, abortController }) {
  return {
    model, env, abortController,
    ...(effort && effort !== 'auto' ? { effort } : {}),
    systemPrompt: system,
    mcpServers: { ripper: builtinTools(agent, ctx), ...userMcp(agent, settings.plugins) },
    settingSources: settings.claude.useConnectors && agent.tools.includes('plugins') ? ['user'] : [],
    tools: web ? ['WebSearch', 'WebFetch'] : [],
    permissionMode: 'dontAsk',
    includePartialMessages: true
  };
}

/** Lista de allowedTools passada ao Claude SDK (testável sem rede). */
export function claudeAllowedTools(agent, settings, ctx) {
  const web = agent.tools.includes('web');
  return [
    ...ripperClaudeToolAllowlist(agent, ctx),
    ...Object.keys(userMcp(agent, settings.plugins)).map(name => `mcp__${name}__*`),
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
    for (const p of settings.plugins.filter(p => p.enabled !== false)) {
      if (p.type === 'http') args.push(...codexMcpConfigLines(p.name, { url: p.url, headers: mcpPluginHttpHeaders(p) }));
      else args.push(...codexMcpConfigLines(p.name, { command: p.command, args: p.args || [] }));
    }
  }
  return args;
}

export async function* runCodex({ agent, effort, prompt, images = [], history, system, settings, cwd, ctx, signal }) {
  ({ prompt, history, system } = lgpdMiddlewareProviderPayload({ prompt, history, system }, settings));
  const bridge = ctx ? await createRipperMcpBridge(agent, ctx) : null;
  const args = buildCodexSpawnArgs({ agent, effort, settings, images, ripperMcpBridge: bridge });
  const full = `${system}\n\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nuser: ${prompt}`;
  const child = spawn('codex', [...args, '-'], { cwd, shell: process.platform === 'win32' });
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
