// Plugins MCP do usuário para provedores sem MCP nativo (OpenRouter, OpenAI, Gemini, Ollama):
// conecta no começo do turno, expõe as ferramentas no formato OpenAI e fecha no fim.
// Plugin fora do ar não derruba o turno: fica de fora, com aviso.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const CONNECT_MS = 10_000;
const CALL_MS = 120_000;

/** Nome aceito pela API da OpenAI (^[a-zA-Z0-9_-]{1,64}$), no mesmo padrão do Claude: mcp__plugin__ferramenta. */
export function mcpToolName(server, tool) {
  const clean = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `mcp__${clean(server)}__${clean(tool)}`.slice(0, 64);
}

// O timer é cancelado quando a resposta chega (antes ficava pendurado 2 min a cada chamada).
function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: sem resposta em ${ms / 1000}s`)), ms); })]).finally(() => clearTimeout(t));
}

async function connect(name, cfg) {
  const client = new Client({ name: 'ripper', version: '1.0.0' });
  if (cfg.type === 'stdio') {
    await withTimeout(client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args || [], stderr: 'ignore' })), CONNECT_MS, name);
    return client;
  }
  const url = new URL(cfg.url), requestInit = { headers: cfg.headers || {} };
  try {
    await withTimeout(client.connect(new StreamableHTTPClientTransport(url, { requestInit })), CONNECT_MS, name);
  } catch {
    // servidores MCP mais antigos só falam SSE
    const old = new Client({ name: 'ripper', version: '1.0.0' });
    await withTimeout(old.connect(new SSEClientTransport(url, { requestInit })), CONNECT_MS, name);
    return old;
  }
  return client;
}

/**
 * servers: { nome: { type: 'stdio', command, args } | { type: 'http', url, headers } } (o mesmo de userMcp).
 * Devolve { tools: [{ name, description, parameters, execute(args) }], warnings: [string], close() }.
 */
export async function connectMcpServers(servers) {
  const clients = [], tools = [], warnings = [];
  await Promise.all(Object.entries(servers || {}).map(async ([server, cfg]) => {
    try {
      const client = await connect(server, cfg);
      clients.push(client);
      const { tools: list = [] } = await withTimeout(client.listTools(), CONNECT_MS, server);
      for (const t of list) {
        tools.push({
          name: mcpToolName(server, t.name),
          description: `[${server}] ${t.description || t.name}`.slice(0, 1000),
          parameters: t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} },
          execute: async args => {
            const r = await withTimeout(client.callTool({ name: t.name, arguments: args }), CALL_MS, `${server}/${t.name}`);
            const text = (r.content || []).map(p => (p.type === 'text' ? p.text : p.type === 'resource' ? p.resource?.text || '' : `[${p.type}]`)).join('\n');
            return { content: [{ type: 'text', text: r.isError ? `Erro do plugin: ${text}` : text || '(sem conteúdo)' }] };
          }
        });
      }
    } catch (e) { warnings.push(`Plugin ${server} indisponível: ${e.message}`); }
  }));
  return { tools, warnings, close: () => Promise.all(clients.map(c => c.close().catch(() => {}))) };
}
