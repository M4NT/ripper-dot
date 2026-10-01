#!/usr/bin/env node
/** Servidor MCP stdio mínimo para testes de supervisão. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'minimal-fixture', version: '1.0.0' });
server.registerTool(
  'ping',
  { description: 'ping', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: 'ok' }] })
);
await server.connect(new StdioServerTransport());
