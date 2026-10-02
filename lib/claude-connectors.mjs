// Conectores da conta claude.ai (Google Agenda, Gmail, Drive, Slack…): o Claude SDK carrega na partida.
// Lemos a lista real na inicialização da sessão e paramos antes de chamar o modelo (não gasta tokens).
import { query } from '@anthropic-ai/claude-agent-sdk';

let cache = { at: 0, list: null };

export async function listClaudeConnectors({ force = false } = {}) {
  if (!force && cache.list && Date.now() - cache.at < 5 * 60_000) return cache.list;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  let list = [];
  try {
    for await (const m of query({ prompt: '.', options: { model: 'claude-haiku-4-5', settingSources: ['user'], tools: [], abortController: ac } })) {
      if (m.type === 'system' && m.subtype === 'init') {
        const tools = m.tools || [];
        list = (m.mcp_servers || [])
          .filter(s => s.name.startsWith('claude.ai '))
          .map(s => {
            const name = s.name.slice('claude.ai '.length);
            const prefix = `mcp__claude_ai_${name.replace(/[^\w]/g, '_')}__`;
            return { name, status: s.status, tools: tools.filter(t => t.startsWith(prefix)).length };
          });
        ac.abort();
        break;
      }
    }
  } catch (e) {
    if (!ac.signal.aborted) throw e;
  } finally { clearTimeout(timer); }
  cache = { at: Date.now(), list };
  return list;
}
