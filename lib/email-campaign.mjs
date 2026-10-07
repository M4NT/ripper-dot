// Campanha de e-mail de verdade: só com a lista que o usuário passou e um e-mail conectado.
// Um e-mail por vez, com intervalo de pessoa (não é disparador em massa), e o usuário pode parar a qualquer momento.

export const MAX_RECIPIENTS = 500;
export const UNSUBSCRIBE_NOTE = 'Para não receber mais estes e-mails, responda com SAIR.';
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** E-mails de uma lista (texto de CSV, planilha ou texto colado): sem repetição, na ordem em que aparecem. */
export function extractEmails(text) {
  const seen = new Set(), out = [];
  for (const m of String(text || '').matchAll(EMAIL)) {
    const e = m[0].toLowerCase().replace(/\.+$/, '');
    if (!seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}

/** Texto final de cada e-mail: o corpo e, no rodapé, como sair da lista. */
export const campaignText = body => `${String(body || '').trim()}\n\n—\n${UNSUBSCRIBE_NOTE}`;

/** Intervalo entre envios: 3 a 6 s, como uma pessoa mandando um por um. */
export const humanGap = (rnd = Math.random) => 3000 + Math.floor(rnd() * 3000);

/**
 * Envia para cada destinatário, um por vez. `send(to)` lança em falha; `stopped()` diz se o usuário parou.
 * `onProgress({ sent, failed, total, status })` a cada passo. Devolve o estado final.
 */
export async function runCampaign({ emails, send, stopped = () => false, onProgress = () => {}, wait = ms => new Promise(r => setTimeout(r, ms)), gap = humanGap }) {
  const st = { sent: 0, failed: 0, total: emails.length, status: 'enviando', errors: [] };
  onProgress({ ...st });
  for (const [i, to] of emails.entries()) {
    if (stopped()) { st.status = 'parada'; break; }
    try { await send(to); st.sent++; } catch (e) { st.failed++; if (st.errors.length < 5) st.errors.push(`${to}: ${e.message}`); }
    onProgress({ ...st });
    if (i < emails.length - 1 && !stopped()) await wait(gap());
  }
  if (st.status === 'enviando') st.status = 'concluída';
  onProgress({ ...st });
  return st;
}
