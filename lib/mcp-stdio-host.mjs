/**
 * Processo filho isolado: executa handshake MCP stdio (SDK) fora do servidor Ripper.
 * Comunicação via IPC (child_process.fork).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function reply(msg) {
  try {
    process.send?.(msg);
  } catch {
    // pai já encerrou
  }
}

async function runProbe({ command, args, listTools, timeoutMs, env }) {
  const transport = new StdioClientTransport({
    command,
    args: args || [],
    stderr: 'pipe',
    env
  });
  const client = new Client({ name: 'ripper-dot-stdio-host', version: '1.0.0' });

  const timer = setTimeout(() => {
    client.close().catch(() => {});
  }, timeoutMs);

  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
    ]);

    let tools, readOnlyTools;
    if (listTools !== false) {
      const listed = await client.listTools();
      tools = (listed.tools || []).map(t => t.name).filter(Boolean).slice(0, 80);
      readOnlyTools = (listed.tools || []).filter(t => t?.name && t.annotations?.readOnlyHint === true).map(t => t.name).slice(0, 80);
    }
    await client.close().catch(() => {});
    clearTimeout(timer);
    return { ok: true, tools, readOnlyTools, detail: 'Processo MCP stdio respondeu.' };
  } catch (e) {
    clearTimeout(timer);
    await client.close().catch(() => {});
    return { ok: false, error: e?.message || 'Falha no stdio' };
  }
}

process.on('message', async msg => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.op === 'shutdown') {
    process.exit(0);
  }

  if (msg.op === 'probe') {
    if (process.env.RIPPER_MCP_HOST_TEST_CRASH === '1') {
      process.exit(99);
    }
    const id = msg.id;
    try {
      const result = await runProbe(msg);
      reply({ id, ...result });
    } catch (e) {
      reply({ id, ok: false, error: e?.message || 'Erro no host', crashed: true });
      process.exit(1);
    }
    return;
  }
});

process.on('uncaughtException', e => {
  reply({ type: 'host_fatal', error: e?.message || String(e) });
  process.exit(1);
});

process.on('unhandledRejection', e => {
  reply({ type: 'host_fatal', error: e?.message || String(e) });
  process.exit(1);
});
