// E-mail como canal: IMAP para ler (ao vivo, sem cópia local) e SMTP para enviar (sempre com aprovação).
// Serve para qualquer provedor: Gmail/Outlook com "senha de app", e-mail da empresa (Hostinger, Locaweb…).
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';

// Provedores comuns: o usuário só digita e-mail e senha de app.
const PRESETS = {
  'gmail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  'googlemail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  'outlook.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'hotmail.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'live.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'yahoo.com': { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' },
  'icloud.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com' }
};

/** Configuração completa a partir do que o usuário preencheu (preenche servidores conhecidos). */
export function emailConfig(e = {}) {
  const domain = String(e.user || '').split('@')[1]?.toLowerCase() || '';
  const p = PRESETS[domain] || {};
  return {
    user: e.user || '', pass: e.pass || '',
    imapHost: e.imapHost || p.imap || (domain && `imap.${domain}`), imapPort: +e.imapPort || 993,
    smtpHost: e.smtpHost || p.smtp || (domain && `smtp.${domain}`), smtpPort: +e.smtpPort || 465
  };
}
export const emailReady = e => !!(e?.enabled && e.user && e.pass);

async function withImap(e, fn) {
  const c = emailConfig(e);
  const client = new ImapFlow({ host: c.imapHost, port: c.imapPort, secure: c.imapPort === 993, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 30_000 });
  // Sem isto, um timeout do IMAP vira 'error' sem dono e derruba o servidor inteiro (aconteceu em 05/10/2026).
  client.on('error', () => {});
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try { return await fn(client); } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
}

const who = a => a?.[0] ? (a[0].name ? `${a[0].name} <${a[0].address}>` : a[0].address) : '';

/** Lista e-mails recentes (mais novos primeiro). query busca em remetente/assunto/corpo. */
export async function listEmails(e, { query, unread, limit = 20, sinceDays = 14 } = {}) {
  return withImap(e, async c => {
    const crit = { since: new Date(Date.now() - sinceDays * 864e5) };
    if (unread) crit.seen = false;
    if (query) crit.or = [{ from: query }, { subject: query }, { body: query }];
    const uids = (await c.search(crit, { uid: true })) || [];
    const pick = uids.slice(-Math.min(limit, 100));
    const out = [];
    if (pick.length) for await (const m of c.fetch(pick, { envelope: true, flags: true }, { uid: true })) {
      out.push({ uid: m.uid, from: who(m.envelope.from), subject: m.envelope.subject || '(sem assunto)', at: m.envelope.date?.getTime?.() || 0, unread: !m.flags?.has('\\Seen') });
    }
    return out.sort((a, b) => b.at - a.at);
  });
}

/** Lê um e-mail (texto puro, cortado). Não marca como lido. */
export async function readEmail(e, uid, max = 8000) {
  return withImap(e, async c => {
    const m = await c.fetchOne(String(uid), { envelope: true, source: true }, { uid: true });
    if (!m) return null;
    const p = await simpleParser(m.source);
    const text = p.text || (p.html ? String(p.html).replace(/<style[^]*?<\/style>|<script[^]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ') : '');
    return {
      uid: m.uid, from: who(m.envelope.from), replyTo: m.envelope.replyTo?.[0]?.address || m.envelope.from?.[0]?.address,
      subject: m.envelope.subject || '', messageId: m.envelope.messageId, at: m.envelope.date?.getTime?.() || 0,
      attachments: (p.attachments || []).map(x => x.filename).filter(Boolean),
      text: text.replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
    };
  });
}

/** UIDs acima de lastUid (e-mails que chegaram desde a última olhada). */
export async function newEmailsSince(e, lastUid) {
  return withImap(e, async c => {
    const next = c.mailbox.uidNext;
    if (!lastUid) return { lastUid: next - 1, items: [] }; // primeira vez: só marca o ponto de partida
    const out = [];
    if (next - 1 > lastUid) for await (const m of c.fetch(`${lastUid + 1}:*`, { envelope: true }, { uid: true })) {
      if (m.uid > lastUid) out.push({ uid: m.uid, from: who(m.envelope.from), subject: m.envelope.subject || '' });
    }
    return { lastUid: Math.max(lastUid, next - 1), items: out };
  });
}

export async function sendEmail(e, { to, subject, text, inReplyTo }) {
  const c = emailConfig(e);
  const t = nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465, auth: { user: c.user, pass: c.pass } });
  return t.sendMail({ from: c.user, to, subject, text, ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}) });
}

/** Confere login IMAP e SMTP (botão "Testar"). */
export async function testEmail(e) {
  const c = emailConfig(e);
  await withImap(e, async () => {});
  await nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465, auth: { user: c.user, pass: c.pass } }).verify();
  return { ok: true, imapHost: c.imapHost, smtpHost: c.smtpHost };
}
