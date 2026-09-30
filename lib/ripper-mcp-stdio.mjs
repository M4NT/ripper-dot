#!/usr/bin/env node
/**
 * Servidor MCP stdio do Ripper — iniciado pelo Codex CLI como filho.
 * Encaminha chamadas de ferramenta para a ponte HTTP no processo do Ripper (RIPPER_MCP_BRIDGE_*).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RIPPER_TOOL_CATALOG } from './ripper-builtin-tools.mjs';

const bridgeUrl = process.env.RIPPER_MCP_BRIDGE_URL;
const bridgeToken = process.env.RIPPER_MCP_BRIDGE_TOKEN;

if (!bridgeUrl || !bridgeToken) {
  console.error('ripper-mcp-stdio: defina RIPPER_MCP_BRIDGE_URL e RIPPER_MCP_BRIDGE_TOKEN');
  process.exit(1);
}

async function bridgeFetch(path, init = {}) {
  const res = await fetch(`${bridgeUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${bridgeToken}`, ...(init.headers || {}) }
  });
  if (!res.ok) throw new Error(`bridge ${path}: ${res.status}`);
  return res.json();
}

const enabled = await bridgeFetch('/tools');
const server = new McpServer({ name: 'ripper', version: '1.0.0' });

for (const { name, description } of enabled) {
  const meta = RIPPER_TOOL_CATALOG[name];
  if (!meta) continue;
  server.registerTool(name, { description: description || meta.description, inputSchema: meta.inputSchema }, async args => {
    const result = await bridgeFetch('/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, arguments: args })
    });
    return result;
  });
}

await server.connect(new StdioServerTransport());
