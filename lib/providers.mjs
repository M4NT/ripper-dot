import { memoryContext } from './agent-flow.mjs';
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
    memoryContext(memories, settings.memoryLogInContext ?? 10),
    has('memory') && 'Para lembrar algo durável, use a ferramenta remember.',
    has('routines') && 'Para agendar algo recorrente, use schedule_routine.',
    has('browser') && settings.computer.mode === 'docker' && 'Você tem um navegador próprio (browser_open, browser_click, browser_type, browser_scroll, browser_read). O usuário vê a sua tela. Nunca digite senhas nem finalize compras sem o usuário pedir.',
    has('computer') && settings.computer.mode === 'docker' && `Seu computador está na rede do time: cada colega é alcançável pelo nome em minúsculas (ex.: http://${agent.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}:3000 é você). A pasta /shared é comum a todos os agentes: use para trocar arquivos.`,
    has('computer') && settings.computer.mode !== 'off' && (settings.computer.mode !== 'local' || settings.computer.allowLocalCommands) && 'Você tem um computador próprio: use computer_exec e computer_share. Arquivos enviados ficam em ./uploads.',
    SKILL
  ].filter(Boolean).join('\n\n');
}

const text = t => ({ content: [{ type: 'text', text: String(t) }] });

function builtinTools(agent, { computer, browser, remember, scheduleRoutine, artifacts, skills, inbox }) {
  const has = t => agent.tools.includes(t);
  const tools = [];
  // Artefatos: entregas que ficam salvas e que os colegas do time podem ler e melhorar.
  // Mensagem assíncrona para um colega (A2A): ele acorda, faz e a resposta volta para esta conversa.
  if (inbox) tools.push(tool('send_message', 'Manda uma tarefa ou pergunta para outro agente, que trabalha nela de forma independente. A resposta volta para esta conversa quando ficar pronta; não espere por ela. Só use quando o colega for claramente o mais indicado.',
    { to: z.string().describe('Nome exato do colega'), message: z.string().max(4000).describe('Pedido completo e autossuficiente: o colega não vê esta conversa'), priority: z.enum(['now', 'normal', 'low']).optional() },
    async a => text(inbox.send(a))));
  // Navegador do agente (Chromium no computador dele). Cada ação devolve título, URL, controles e texto.
  if (browser) tools.push(
    tool('browser_open', 'Abre um endereço no navegador do agente.', { url: z.string() }, async a => text(await browser.open(a.url))),
    tool('browser_click', 'Clica num link ou botão, pelo texto visível ou seletor CSS.', { target: z.string() }, async a => text(await browser.click(a.target))),
    tool('browser_type', 'Digita num campo (texto visível, placeholder ou seletor). submit=true aperta Enter.', { target: z.string(), text: z.string(), submit: z.boolean().optional() }, async a => text(await browser.type(a.target, a.text, a.submit))),
    tool('browser_scroll', 'Rola a página (dy positivo desce).', { dy: z.number().optional() }, async a => text(await browser.scroll(a.dy))),
    tool('browser_read', 'Lê a página atual de novo.', {}, async () => text(await browser.read())));
  if (artifacts) tools.push(
    tool('save_artifact', 'Salva (ou atualiza, pelo mesmo título) uma entrega durável: roteiro, plano, texto final, tabela. Use para o que o usuário ou o time vão reaproveitar.',
      { title: z.string().max(120), content: z.string().max(60000), kind: z.enum(['documento', 'roteiro', 'plano', 'post', 'codigo', 'tabela', 'outro']).optional() },
      async a => text(artifacts.save(a))),
    tool('read_artifact', 'Lê o conteúdo completo de um artefato do time pelo título.', { title: z.string() }, async a => text(artifacts.read(a.title))));
  // Skills: receitas reutilizáveis. O prompt só lista nomes; o conteúdo é carregado quando preciso.
  if (skills) tools.push(
    tool('use_skill', 'Carrega as instruções completas de uma skill pelo nome.', { name: z.string() }, async a => text(skills.use(a.name))),
    tool('save_skill', 'Cria ou atualiza uma skill: um passo a passo reutilizável que funcionou bem.',
      { name: z.string().max(60), description: z.string().max(200), content: z.string().max(20000) }, async a => text(skills.save(a))));
  if (has('memory')) tools.push(tool('remember', 'Guarda algo para conversas futuras. tier "profile": fato estável sobre o usuário (preferência, contexto, quem é). tier "log": o que aconteceu ou foi decidido (fica datado).',
    { text: z.string().max(500), tier: z.enum(['profile', 'log']).optional() }, async a => (remember(a.text, a.tier), text('ok'))));
  if (has('routines')) tools.push(tool('schedule_routine', 'Cria rotina recorrente. everyMinutes OU dailyAt "HH:MM" (+ weekday 0-6).',
    { name: z.string(), prompt: z.string(), everyMinutes: z.number().min(5).optional(), dailyAt: z.string().regex(/^\d\d:\d\d$/).optional(), weekday: z.number().min(0).max(6).optional() },
    async a => (scheduleRoutine(a), text('rotina criada'))));
  if (computer && has('computer')) tools.push(
    tool('computer_exec', 'Roda um comando shell no computador do agente.', { command: z.string() }, async a => text(await computer.exec(a.command))),
    tool('computer_share', 'Gera link público para uma porta do computador.', { port: z.number() }, async a => text(await computer.share(a.port))));
  return createSdkMcpServer({ name: 'ripper', version: '1.0.0', tools });
}

export function userMcp(agent, plugins) {
  if (!agent.tools.includes('plugins')) return {};
  return Object.fromEntries(plugins.filter(p => p.enabled !== false).map(p => [p.name,
    p.type === 'http' ? { type: 'http', url: p.url, headers: p.headers || {} } : { type: 'stdio', command: p.command, args: p.args || [] }]));
}

// Rótulo + detalhe curto para a linha do tempo de ferramentas.
function describe(name, input = {}) {
  const n = name.replace(/^mcp__ripper__/, '');
  const d = { browser_open: input.url, browser_click: input.target, browser_type: input.target && `${input.target}${input.submit ? ' ↵' : ''}`, send_message: input.to && `→ ${input.to}${input.priority === 'now' ? ' (urgente)' : ''}`, save_artifact: input.title, read_artifact: input.title, use_skill: input.name, save_skill: input.name, computer_exec: input.command, computer_share: input.port && `porta ${input.port}`, WebSearch: input.query, WebFetch: input.url, remember: input.text, schedule_routine: input.name }[n];
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
  for await (const m of q) {
    if (m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') yield { text: m.event.delta.text };
    else if (m.type === 'assistant') { for (const b of m.message.content) if (b.type === 'tool_use') yield describe(b.name, b.input); }
    else if (m.type === 'result' && m.is_error) throw new Error(m.subtype + ': ' + (m.errors?.join('; ') || 'erro'));
  }
}

// Codex CLI usa o login do ChatGPT (`codex login`). MCPs extras via -c.
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
    ...(ctx.artifacts ? ['mcp__ripper__save_artifact', 'mcp__ripper__read_artifact'] : []),
    ...(ctx.inbox ? ['mcp__ripper__send_message'] : []),
    ...(ctx.browser ? ['mcp__ripper__browser_open', 'mcp__ripper__browser_click', 'mcp__ripper__browser_type', 'mcp__ripper__browser_scroll', 'mcp__ripper__browser_read'] : []),
    ...(ctx.skills ? ['mcp__ripper__use_skill', 'mcp__ripper__save_skill'] : []),
    ...(hasTool(agent, 'memory') ? ['mcp__ripper__remember'] : []),
    ...(hasTool(agent, 'routines') ? ['mcp__ripper__schedule_routine'] : []),
    ...(ctx.computer && hasTool(agent, 'computer') ? ['mcp__ripper__computer_exec', 'mcp__ripper__computer_share'] : []),
    ...Object.keys(userMcp(agent, settings.plugins)).map(name => `mcp__${name}__*`),
    ...(web ? ['WebSearch', 'WebFetch'] : [])
  ];
}

/** Argumentos do spawn codex exec (testável sem CLI real). */
export function buildCodexSpawnArgs({ agent, effort, settings, images = [] }) {
  const localComputer = agent.tools.includes('computer') && settings.computer.mode === 'local' && settings.computer.allowLocalCommands;
  const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', localComputer ? 'workspace-write' : 'read-only'];
  if (CODEX_EFFORT[effort]) args.push('-c', `model_reasoning_effort="${CODEX_EFFORT[effort]}"`);
  for (const i of images) args.push('-i', i.path);
  if (agent.tools.includes('plugins')) for (const p of settings.plugins.filter(p => p.enabled !== false && p.type !== 'http'))
    args.push('-c', `mcp_servers.${p.name}.command=${JSON.stringify(p.command)}`, '-c', `mcp_servers.${p.name}.args=${JSON.stringify(p.args || [])}`);
  return args;
}

export async function* runCodex({ agent, effort, prompt, images = [], history, system, settings, cwd, signal }) {
  const args = buildCodexSpawnArgs({ agent, effort, settings, images });
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
