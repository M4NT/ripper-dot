// Caixa: tudo que pede a atenção do dono, num lugar só — aprovações pendentes, recados dos agentes
// de canal (WhatsApp) e novidades de rotina. Lê do que já existe; não duplica dados.

/** @returns {{ items: object[], count: number }} */
export function buildInbox(db) {
  const agentName = id => db.agents.find(a => a.id === id)?.name || 'Agente';
  const items = [];
  for (const a of db.approvals || []) {
    if (a.status !== 'pending') continue;
    items.push({ kind: 'approval', id: a.id, agentId: a.agentId, agentName: agentName(a.agentId), at: a.createdAt, approval: a });
  }
  for (const c of db.chats || []) {
    if (String(c.channelKey || '').startsWith('owner:')) {
      for (const m of c.messages || []) {
        if (m.via?.type !== 'owner-notify' || m.done) continue;
        items.push({
          kind: 'notice', id: m.id, chatId: c.id, agentId: c.agentId, agentName: agentName(c.agentId), at: m.at,
          contact: m.via.contact, phone: m.via.phone || (/\+(\d{10,15})/.exec(m.via.contact || '') || [])[1] || '', ...noticeText(m)
        });
      }
    } else if (c.routineId && c.unread) {
      const reply = [...(c.messages || [])].reverse().find(m => m.role === 'assistant');
      items.push({
        kind: 'routine', id: c.id, chatId: c.id, agentId: c.agentId, agentName: agentName(c.agentId), at: c.updatedAt || c.createdAt,
        title: c.title, preview: String(reply?.content || reply?.error || '').slice(0, 400), urgent: !!c.urgent, failed: !!reply?.error
      });
    }
  }
  for (const a of db.systemAlerts || []) {
    if (!a.done) items.push({ kind: 'system', id: a.id, at: a.at, title: a.title, body: a.body, href: a.href, hrefLabel: a.hrefLabel, urgent: !a.quiet, quiet: !!a.quiet });
  }
  for (const a of db.spendAlerts || []) {
    if (a.done) continue;
    items.push({ kind: 'spend', id: a.id, agentId: a.agentId, agentName: agentName(a.agentId), at: a.at, which: a.which, limitUsd: a.limitUsd, urgent: true });
  }
  // urgente e aprovação primeiro (alguém está esperando), depois o mais recente
  const weight = it => (it.kind === 'approval' ? 2 : 0) + (it.urgent ? 3 : 0);
  items.sort((x, y) => weight(y) - weight(x) || y.at - x.at);
  return { items, count: items.length };
}

/** Recados antigos só têm o texto pronto ("**Recado…**", "**Ação sugerida:** …", "Responda aqui…"): separa resumo e ação. */
function noticeText(m) {
  if (m.via.summary) return { summary: m.via.summary, action: m.via.action || '' };
  let action = '';
  const body = String(m.content || '').split('\n').filter(l => {
    if (/^\*\*Recado do WhatsApp/.test(l) || /^Responda aqui/.test(l)) return false;
    const hit = /^\*\*Ação sugerida:\*\*\s*(.*)/.exec(l);
    if (hit) { action = hit[1]; return false; }
    return true;
  });
  return { summary: body.join('\n').replace(/\*\*/g, '').trim(), action };
}

/** Marca um item como resolvido. Aprovações se resolvem aprovando/negando, não aqui. */
export function resolveInboxItem(db, kind, id) {
  if (kind === 'notice') {
    for (const c of db.chats) for (const m of c.messages || []) if (m.id === id && m.via?.type === 'owner-notify') { m.done = true; return true; }
    return false;
  }
  if (kind === 'spend' || kind === 'system') {
    const a = (db[kind === 'spend' ? 'spendAlerts' : 'systemAlerts'] || []).find(x => x.id === id);
    if (a) a.done = true;
    return !!a;
  }
  if (kind === 'routine') {
    const c = db.chats.find(x => x.id === id && x.routineId);
    if (!c) return false;
    c.unread = false; c.urgent = false;
    return true;
  }
  return false;
}

