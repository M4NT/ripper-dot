import { redactSecretsInLogText } from './redact.mjs';
import { redactBrazilianPii } from './lgpd-pii.mjs';

// Últimos erros do processo (console.error), para o relatório de suporte.
// ponytail: só em memória, perde no reinício; gravar em disco se suporte precisar de erros antigos.
const ring = [];
let hooked = false;
export function captureConsoleErrors(max = 200) {
  if (hooked) return;
  hooked = true;
  const orig = console.error.bind(console);
  console.error = (...a) => {
    try {
      ring.push({ at: Date.now(), text: a.map(x => x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x)).join(' ').slice(0, 2000) });
      if (ring.length > max) ring.splice(0, ring.length - max);
    } catch { /* nunca quebrar o log */ }
    orig(...a);
  };
}
export const recentErrors = () => ring.slice();

/** Tira segredos e dados pessoais (CPF, telefone, e-mail, conta…) — sempre, independente da opção LGPD. */
export function sanitizeForSupport(text) {
  return redactBrazilianPii(redactSecretsInLogText(String(text ?? ''))).text
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[user]')
    .replace(/\/(home|Users)\/[^/\s]+/g, '/$1/[user]');
}

const st = (ok, label, detail) => ({ status: ok === null ? 'off' : ok ? 'ok' : 'error', label, detail });

/** Resumo para o painel de saúde. Entradas já coletadas (testável). */
export function buildHealth({ uptimeSec, docker, claudeAccounts = [], whatsapp, email, outboxCounts = {}, lastBackupAt, backupEnabled, now = Date.now() }) {
  const dayMs = 86400_000;
  return {
    at: now,
    items: [
      st(true, 'Servidor', `No ar há ${Math.round(uptimeSec / 60)} min`),
      st(!!docker?.version, 'Docker', docker?.version ? `Versão ${docker.version}${docker.outdated ? ' · imagem desatualizada' : ''}` : 'Não encontrado'),
      ...claudeAccounts.map(a => st(a.loggedIn && !a.exhaustedUntil, `Claude · ${a.label}`, !a.loggedIn ? 'Sem login' : a.exhaustedUntil ? `Limite até ${new Date(a.exhaustedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Conectada')),
      whatsapp?.enabled ? st(whatsapp.state === 'open', 'WhatsApp', whatsapp.state === 'open' ? 'Conectado' : `Estado: ${whatsapp.state || 'desconhecido'}`) : st(null, 'WhatsApp', 'Desligado'),
      email?.enabled ? st(email.ready, 'E-mail', email.ready ? 'Configurado' : 'Falta usuário ou senha') : st(null, 'E-mail', 'Desligado'),
      st(!outboxCounts.dead, 'Fila de envios', `${outboxCounts.pending || 0} na fila · ${outboxCounts.dead || 0} não saíram`),
      !lastBackupAt ? st(backupEnabled ? false : null, 'Último backup', 'Nenhum backup ainda')
        : st(!backupEnabled || now - lastBackupAt < 2 * dayMs, 'Último backup', new Date(lastBackupAt).toLocaleString('pt-BR'))
    ]
  };
}

/** Texto do relatório de erro, já sem dados pessoais. */
export function buildErrorReport({ health, diagnostics, errors = [], alerts = [], version }) {
  const lines = [
    `Relatório Ripper ${version || ''} · ${new Date().toISOString()}`,
    '', '== Saúde ==',
    ...(health?.items || []).map(i => `[${i.status}] ${i.label}: ${i.detail}`),
    '', '== Diagnóstico ==', JSON.stringify(diagnostics?.runtime || {}, null, 1),
    JSON.stringify(diagnostics?.providers || {}, null, 1),
    '', '== Avisos recentes ==',
    ...alerts.slice(-30).map(a => `${new Date(a.at).toISOString()} ${a.done ? '(resolvido) ' : ''}${a.title}: ${a.body || ''} ${a.error || ''}`),
    '', '== Erros recentes ==',
    ...errors.slice(-100).map(e => `${new Date(e.at).toISOString()} ${e.text}`)
  ];
  return sanitizeForSupport(lines.join('\n'));
}
