import { fileURLToPath } from 'node:url';

/**
 * Valor TOML para `-c`: string literal entre aspas simples (sem escapes), lista e tabela inline.
 * JSON não serve: no Windows o cmd tira as aspas duplas e o Codex recebe `[C:\...]`, que não é TOML.
 */
export function toml(v) {
  if (Array.isArray(v)) return `[${v.map(toml).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)} = ${toml(x)}`).join(', ')} }`;
  const t = String(v);
  return t.includes("'") || /[\r\n]/.test(t) ? JSON.stringify(t) : `'${t}'`;
}

/** Linhas `-c` para o Codex CLI (`mcp_servers.<nome>.*` no config.toml efêmero). */
export function codexMcpConfigLines(serverName, { command, args, url, env, headers }) {
  const out = [];
  const key = `mcp_servers.${serverName}`;
  if (command != null) out.push('-c', `${key}.command=${toml(command)}`);
  if (args?.length) out.push('-c', `${key}.args=${toml(args)}`);
  if (url) out.push('-c', `${key}.url=${toml(url)}`);
  if (headers && Object.keys(headers).length) out.push('-c', `${key}.http_headers=${toml(headers)}`);
  for (const [k, v] of Object.entries(env || {})) out.push('-c', `${key}.env.${k}=${toml(v)}`);
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
