import { fileURLToPath } from 'node:url';

/** Linhas `-c` para o Codex CLI (`mcp_servers.<nome>.*` no config.toml efêmero). */
export function codexMcpConfigLines(serverName, { command, args, url, env, headers }) {
  const out = [];
  const key = `mcp_servers.${serverName}`;
  if (command != null) out.push('-c', `${key}.command=${JSON.stringify(command)}`);
  if (args?.length) out.push('-c', `${key}.args=${JSON.stringify(args)}`);
  if (url) out.push('-c', `${key}.url=${JSON.stringify(url)}`);
  if (headers && Object.keys(headers).length) out.push('-c', `${key}.http_headers=${JSON.stringify(headers)}`);
  for (const [k, v] of Object.entries(env || {})) out.push('-c', `${key}.env.${k}=${JSON.stringify(v)}`);
  return out;
}

/** Registra o servidor MCP builtin `ripper` para o spawn do Codex (stdio → ponte HTTP). */
export function ripperCodexMcpArgs(bridge) {
  const stdioScript = fileURLToPath(new URL('./ripper-mcp-stdio.mjs', import.meta.url));
  return codexMcpConfigLines('ripper', {
    command: process.execPath,
    args: [stdioScript],
    env: {
      RIPPER_MCP_BRIDGE_URL: bridge.url,
      RIPPER_MCP_BRIDGE_TOKEN: bridge.token
    }
  });
}
