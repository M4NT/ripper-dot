import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { buildRipperBuiltinTools } from './ripper-builtin-tools.mjs';
import { maybeChaosMcpFailure, resolveEffectiveChaos } from './chaos.mjs';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Ponte HTTP local: o processo MCP stdio (filho do Codex) chama as ferramentas Ripper no processo do servidor.
 * @returns {Promise<{ url: string, token: string, close: () => Promise<void> } | null>}
 */
export function createRipperMcpBridge(agent, ctx) {
  const defs = buildRipperBuiltinTools(agent, ctx);
  if (!defs.length) return Promise.resolve(null);

  const byName = new Map(defs.map(d => [d.name, d]));
  const token = randomBytes(24).toString('hex');

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401);
        res.end();
        return;
      }
      try {
        if (req.method === 'GET' && req.url === '/tools') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(defs.map(({ name, description }) => ({ name, description }))));
          return;
        }
        if (req.method === 'POST' && req.url === '/call') {
          const chaos = resolveEffectiveChaos(ctx?.db?.settings);
          const mcpErr = maybeChaosMcpFailure(chaos, ctx?.db?.settings);
          if (mcpErr) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: mcpErr.message }));
            return;
          }
          const body = JSON.parse(await readBody(req) || '{}');
          const def = byName.get(body.name);
          if (!def) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'unknown tool' }));
            return;
          }
          const result = await def.execute(body.arguments || {});
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }
        res.writeHead(404);
        res.end();
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        token,
        close: () => new Promise((r, j) => server.close(err => (err ? j(err) : r())))
      });
    });
  });
}
