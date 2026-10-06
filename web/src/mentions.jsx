import { AgentAvatar } from './ui.jsx';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Nomes mais longos primeiro: "@Ana Paula" não vira "@Ana"
const pattern = agents => {
  const names = agents.map(a => a.name).filter(Boolean).sort((a, b) => b.length - a.length).map(esc);
  return names.length ? new RegExp(`@(${names.join('|')})(?![\\p{L}\\d])`, 'gu') : null;
};

/** Agentes marcados no texto, na ordem em que aparecem (sem repetir). */
export function mentionedAgents(text, agents) {
  const re = pattern(agents);
  if (!re || !text) return [];
  const seen = new Set();
  return [...text.matchAll(re)].map(m => agents.find(a => a.name === m[1])).filter(a => a && !seen.has(a.id) && seen.add(a.id));
}

export const MentionChip = ({ agent }) => <span className="mention-chip"><AgentAvatar agent={agent} size={18} paused />@{agent.name}</span>;

/** Texto com cada "@Nome" de agente trocado por um botão com o mascote. */
export function MentionText({ text, agents }) {
  const re = pattern(agents);
  if (!re || !text) return text;
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    out.push(<MentionChip key={m.index} agent={agents.find(a => a.name === m[1])} />);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}
