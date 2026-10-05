// Resumo diário ("Pulse"): o que os agentes fizeram nas últimas 24h, o que espera você e quanto gastou.
// Montado a partir do que já está gravado — sem chamar modelo nenhum (zero tokens).

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** @returns {{ title: string, body: string, empty: boolean }} */
export function buildPulse(db, { now = Date.now(), external = [], inboxCount = 0 } = {}) {
  const since = now - 24 * 3600_000;
  const name = id => db.agents.find(a => a.id === id)?.name || 'Agente';
  const per = new Map(); // agentId → { replies, actions, errors }
  const bump = (id, k) => { const r = per.get(id) || { replies: 0, actions: 0, errors: 0 }; r[k]++; per.set(id, r); };
  for (const c of db.chats || []) {
    if (String(c.channelKey || '').startsWith('owner:')) continue;
    for (const m of c.messages || []) {
      if (m.role !== 'assistant' || !(m.at >= since) || !m.agentId) continue;
      if (m.error) bump(m.agentId, 'errors');
      else bump(m.agentId, 'replies');
      for (let i = 0; i < (m.steps?.length || 0); i++) bump(m.agentId, 'actions');
    }
  }
  const files = (db.files || []).filter(f => f.delivered && f.createdAt >= since);
  const routines = (db.routines || []).filter(r => r.lastRun >= since);
  const failedRoutines = routines.filter(r => r.lastStatus === 'error');
  const ext = external.filter(e => e.at >= since);
  const whats = ext.filter(e => e.action?.startsWith('whatsapp.')).length;
  const posts = ext.filter(e => e.action === 'social.posted').length;
  const spend = db.paidSpend?.total || 0;

  const lines = [];
  const agents = [...per.entries()].sort((a, b) => b[1].replies - a[1].replies);
  for (const [id, r] of agents.slice(0, 6)) {
    lines.push(`• ${name(id)}: ${plural(r.replies, 'resposta', 'respostas')}${r.actions ? `, ${plural(r.actions, 'ação', 'ações')}` : ''}${r.errors ? ` — ${plural(r.errors, 'falha', 'falhas')}` : ''}`);
  }
  if (agents.length > 6) lines.push(`• e mais ${plural(agents.length - 6, 'agente', 'agentes')}`);
  if (files.length) lines.push(`• ${plural(files.length, 'arquivo entregue', 'arquivos entregues')}`);
  if (routines.length) lines.push(`• ${plural(routines.length, 'rotina rodou', 'rotinas rodaram')}${failedRoutines.length ? ` (${failedRoutines.map(r => r.name).join(', ')} falhou)` : ''}`);
  if (whats || posts) lines.push(`• Em seu nome: ${[whats && plural(whats, 'mensagem no WhatsApp', 'mensagens no WhatsApp'), posts && plural(posts, 'publicação', 'publicações')].filter(Boolean).join(' e ')}`);
  if (spend > 0) lines.push(`• Gasto pago hoje: US$ ${spend.toFixed(2)}`);
  const empty = !lines.length;
  if (empty) lines.push('Os agentes não trabalharam nas últimas 24 horas.');
  if (inboxCount) lines.push('', `${plural(inboxCount, 'item espera', 'itens esperam')} por você na Caixa.`);
  return { title: 'Resumo do dia', body: lines.join('\n'), empty };
}

/** Hora de mandar o resumo de hoje? (uma vez por dia, a partir da hora escolhida) */
export function pulseDue(settings, lastDay, now = new Date()) {
  const p = settings?.pulse || {};
  if (p.enabled === false) return null;
  const day = now.toLocaleDateString('sv'); // dia local (AAAA-MM-DD)
  return day !== lastDay && now.getHours() >= (p.hour ?? 8) ? day : null;
}
