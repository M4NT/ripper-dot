// Processo do Claude pré-aquecido por agente: o próximo turno pula partida, login e handshake dos MCPs.
// Tudo que o processo fixa no prewarm (prompt fixo, ferramentas, MCPs, env) entra na chave; mudou → processo novo.
import { createHash } from 'node:crypto';
import { prewarm } from '@anthropic-ai/claude-agent-sdk';

// ponytail: até 3 processos parados (~250 MB cada), sai o mais antigo; por uso recente se houver muitos agentes.
const MAX_SPARES = 3;
const spares = new Map(); // chave → Promise<{ spare, holder } | null>
const lastByAgent = new Map(); // agente → { key, make } do último turno (para reaquecer ao abrir a conversa)

export const spareKey = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/**
 * Pega o processo pronto para esta chave (ou null) e já aquece o do próximo turno.
 * make() → { options, holder }: holder.ctx é trocado a cada turno (as ferramentas leem dele na hora).
 */
export async function takeSpare(key, make, agentId) {
  if (agentId) lastByAgent.set(agentId, { key, make });
  const ready = spares.get(key);
  spares.delete(key);
  if (!process.env.RIPPER_NO_PREWARM) warm(key, make);
  return ready ? ready.catch(() => null) : null;
}

function warm(key, make) {
  const { options, holder } = make();
  spares.set(key, prewarm({ options }).then(spare => ({ spare, holder })).catch(() => { spares.delete(key); return null; }));
  while (spares.size > MAX_SPARES) {
    const [old, p] = spares.entries().next().value;
    spares.delete(old);
    p.then(s => s?.spare.close()).catch(() => {});
  }
}

/**
 * Abriu a conversa: garante o processo pronto do agente (se ele já rodou neste servidor) e o marca como
 * recente, para não ser o descartado. Respeita MAX_SPARES: muitos agentes abertos não estouram a memória.
 * ponytail: só agente que já teve turno desde a subida; o 1º turno após reiniciar segue frio.
 */
export function warmAgent(agentId) {
  const last = lastByAgent.get(agentId);
  if (!last || process.env.RIPPER_NO_PREWARM) return false;
  const ready = spares.get(last.key);
  if (ready) { spares.delete(last.key); spares.set(last.key, ready); return false; }
  warm(last.key, last.make);
  return true;
}

export function closeSpares() {
  for (const p of spares.values()) p.then(s => s?.spare.close()).catch(() => {});
  spares.clear();
}
