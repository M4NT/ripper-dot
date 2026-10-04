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
    for await (const m of query({ prompt: '.', options: { model: 'claude-haiku-4-5', settingSources: ['user'], tools: [], abortController: ac, env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1' } } })) {
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

// Abrir os conectores custa 3–5s por mensagem (medido em 04/10/2026). Só carregamos de saída quando o
// pedido parece precisar; nos outros casos o agente tem a ferramenta use_connectors e recomeça com eles.
const CONNECTOR_WORDS = /\b(agenda|calend[aá]rio|compromisso|reuni[aã]o|evento|marcad[oa]|hor[aá]rio livre|drive|planilha|documento|docs?|pasta|gmail|e-?mails?|caixa de entrada|slack|notion|jira|github|figma|hubspot|canva|asana|linear)\b/i;

export function wantsConnectors(text = '') {
  if (CONNECTOR_WORDS.test(text)) return true;
  const names = (cache.list || []).map(c => c.name.toLowerCase().split(/\s+/)).flat().filter(w => w.length > 3 && w !== 'google');
  const t = text.toLowerCase();
  return names.some(w => t.includes(w));
}
