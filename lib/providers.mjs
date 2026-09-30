// Claude (assinatura via login do Claude Code, ou API key) e Codex (login ChatGPT via `codex login`).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const SKILL = readFileSync(new URL('../skills/token-the-ripper.md', import.meta.url), 'utf8');
const TONES = { direto: 'Tom direto e objetivo.', amigavel: 'Tom caloroso e próximo.', formal: 'Tom formal e cuidadoso.', tecnico: 'Tom técnico e preciso.' };

export function systemPrompt(agent, settings, memories) {
  const has = t => agent.tools.includes(t);
  return [
    `Você é ${agent.name}, um agente do Ripper.${agent.description ? ` Função: ${agent.description}` : ''}`,
    TONES[agent.tone],
    'Seja breve por padrão: responda em até 4 frases curtas ou até 5 itens. Só se estenda quando pedirem detalhes, um documento ou código completo.',
    agent.instructions,
    settings.name && `O usuário se chama ${settings.name}.`,
    settings.customInstructions,
    memories.length && `Memórias:\n${memories.map(m => `- ${m.text}`).join('\n')}`,
    has('memory') && 'Para lembrar algo durável, use a ferramenta remember.',
    has('routines') && 'Para agendar algo recorrente, use schedule_routine.',
    has('computer') && settings.computer.mode !== 'off' && (settings.computer.mode !== 'local' || settings.computer.allowLocalCommands) && 'Você tem um computador próprio: use computer_exec e computer_share. Arquivos enviados ficam em ./uploads.',
    SKILL
  ].filter(Boolean).join('\n\n');
}

const text = t => ({ content: [{ type: 'text', text: String(t) }] });

function builtinTools(agent, { computer, remember, scheduleRoutine }) {
  const has = t => agent.tools.includes(t);
  const tools = [];
  if (has('memory')) tools.push(tool('remember', 'Salva um fato durável sobre o usuário.', { text: z.string().max(500) }, async a => (remember(a.text), text('ok'))));
  if (has('routines')) tools.push(tool('schedule_routine', 'Cria rotina recorrente. everyMinutes OU dailyAt "HH:MM" (+ weekday 0-6).',
    { name: z.string(), prompt: z.string(), everyMinutes: z.number().min(5).optional(), dailyAt: z.string().regex(/^\d\d:\d\d$/).optional(), weekday: z.number().min(0).max(6).optional() },
    async a => (scheduleRoutine(a), text('rotina criada'))));
  if (computer && has('computer')) tools.push(
    tool('computer_exec', 'Roda um comando shell no computador do agente.', { command: z.string() }, async a => text(await computer.exec(a.command))),
    tool('computer_share', 'Gera link público para uma porta do computador.', { port: z.number() }, async a => text(await computer.share(a.port))));
  return createSdkMcpServer({ name: 'ripper', version: '1.0.0', tools });
}

function userMcp(agent, plugins) {
  if (!agent.tools.includes('plugins')) return {};
  return Object.fromEntries(plugins.filter(p => p.enabled !== false).map(p => [p.name,
    p.type === 'http' ? { type: 'http', url: p.url, headers: p.headers || {} } : { type: 'stdio', command: p.command, args: p.args || [] }]));
}

// Rótulo + detalhe curto para a linha do tempo de ferramentas.
function describe(name, input = {}) {
  const n = name.replace(/^mcp__ripper__/, '');
  const d = { computer_exec: input.command, computer_share: input.port && `porta ${input.port}`, WebSearch: input.query, WebFetch: input.url, remember: input.text, schedule_routine: input.name }[n];
  return { tool: n, detail: d ? String(d).slice(0, 160) : undefined };
}

export async function* runClaude({ agent, model, effort, prompt, images = [], history, system, settings, ctx, signal }) {
  const abortController = new AbortController();
  signal?.addEventListener('abort', () => abortController.abort(), { once: true });
  const env = { ...process.env };
  if (settings.claude.mode === 'api' && settings.claude.apiKey) env.ANTHROPIC_API_KEY = settings.claude.apiKey;
  else delete env.ANTHROPIC_API_KEY; // força o login da assinatura do Claude Code

  const web = agent.tools.includes('web');
  const transcript = history.map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`).join('\n\n');
  const textPrompt = transcript ? `${transcript}\n\nUsuário: ${prompt}` : prompt;
  // Com imagens, a mensagem vai em blocos (texto + imagens) para o modelo enxergar de fato.
  const allowedTools = [
    ...(hasTool(agent, 'memory') ? ['mcp__ripper__remember'] : []),
    ...(hasTool(agent, 'routines') ? ['mcp__ripper__schedule_routine'] : []),
    ...(ctx.computer && hasTool(agent, 'computer') ? ['mcp__ripper__computer_exec', 'mcp__ripper__computer_share'] : []),
    ...Object.keys(userMcp(agent, settings.plugins)).map(name => `mcp__${name}__*`),
    ...(web ? ['WebSearch', 'WebFetch'] : [])
  ];
  const q = query({
    prompt: images.length ? (async function* () {
      yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
        { type: 'text', text: textPrompt },
        ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } }))
      ] } };
    })() : textPrompt,
    options: {
      model, env, abortController,
      ...(effort && effort !== 'auto' ? { effort } : {}),
      systemPrompt: system,
      mcpServers: { ripper: builtinTools(agent, ctx), ...userMcp(agent, settings.plugins) },
      settingSources: settings.claude.useConnectors ? ['user'] : [],
      tools: web ? ['WebSearch', 'WebFetch'] : [],
      allowedTools,
      permissionMode: 'dontAsk',
      includePartialMessages: true
    }
  });
  for await (const m of q) {
    if (m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') yield { text: m.event.delta.text };
    else if (m.type === 'assistant') { for (const b of m.message.content) if (b.type === 'tool_use') yield describe(b.name, b.input); }
    else if (m.type === 'result' && m.is_error) throw new Error(m.subtype + ': ' + (m.errors?.join('; ') || 'erro'));
  }
}

const hasTool = (agent, name) => agent.tools.includes(name);

// Codex CLI usa o login do ChatGPT (`codex login`). MCPs extras via -c.
const CODEX_EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };
export async function* runCodex({ agent, effort, prompt, images = [], history, system, settings, cwd, signal }) {
  const localComputer = agent.tools.includes('computer') && settings.computer.mode === 'local' && settings.computer.allowLocalCommands;
  const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', localComputer ? 'workspace-write' : 'read-only'];
  if (CODEX_EFFORT[effort]) args.push('-c', `model_reasoning_effort="${CODEX_EFFORT[effort]}"`);
  for (const i of images) args.push('-i', i.path);
  if (agent.tools.includes('plugins')) for (const p of settings.plugins.filter(p => p.enabled !== false && p.type !== 'http'))
    args.push('-c', `mcp_servers.${p.name}.command=${JSON.stringify(p.command)}`, '-c', `mcp_servers.${p.name}.args=${JSON.stringify(p.args || [])}`);
  const full = `${system}\n\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nuser: ${prompt}`;
  const child = spawn('codex', [...args, '-'], { cwd, shell: process.platform === 'win32' });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.end(full);
  signal?.addEventListener('abort', () => child.kill(), { once: true });
  let buf = '', err = '';
  child.stderr.on('data', d => err += d);
  const done = new Promise(r => child.on('close', r));
  for await (const chunk of child.stdout) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try {
        const e = JSON.parse(line);
        const item = e.item || e.msg;
        if (item?.type === 'agent_message' && item.text) yield { text: item.text };
        else if (item?.type === 'command_execution') yield { tool: 'computer_exec', detail: item.command?.slice?.(0, 160) };
      } catch {}
    }
  }
  if (await done) throw new Error('codex: ' + (err.slice(-400).trim() || 'não respondeu. Rode `codex login` nesta máquina.'));
}
