// Aprovação humana: o agente propõe uma ação, o usuário aprova ou nega antes de ela acontecer.

// Padrões de comando que podem destruir dados, gastar dinheiro, publicar algo ou sair da caixa de areia.
const RISKY = [
  [/\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, 'apaga arquivos em massa'],
  [/\b(del|rmdir|rd)\s+\/[sq]/i, 'apaga arquivos em massa'],
  [/\b(mkfs|fdisk|dd\s+if=|format\s+[a-z]:)/i, 'mexe em disco'],
  [/\b(shutdown|reboot|halt|poweroff)\b/i, 'desliga ou reinicia a máquina'],
  [/\bsudo\b|\bsu\s+-?\s*\w*$/i, 'usa privilégio de administrador'],
  [/\bgit\s+push\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f/i, 'altera ou descarta histórico do git'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b|\bvercel\s+(--prod|deploy)/i, 'publica algo'],
  [/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/i, 'executa script baixado da internet'],
  [/\bchmod\s+-R\b|\bchown\s+-R\b/i, 'muda permissões em massa'],
  [/\b(kill|pkill|killall)\b/i, 'encerra processos'],
  [/>\s*\/dev\/sd|\/etc\/(passwd|shadow|sudoers)/i, 'mexe em arquivos do sistema'],
  [/\b(crontab|systemctl|service)\b/i, 'altera serviços da máquina'],
  [/\b(ssh|scp|rsync)\b.*@/i, 'acessa outra máquina'],
  [/\b(drop\s+(table|database)|truncate\s+table|delete\s+from)\b/i, 'apaga dados de banco']
];

/** Motivo de risco do comando, ou null se for rotineiro. */
export function riskOf(command) {
  for (const [re, why] of RISKY) if (re.test(command)) return why;
  return null;
}

/**
 * Decide se a ação precisa de aprovação.
 * policy: 'risky' (padrão) | 'always' | 'never'. Na máquina do usuário ('local') sempre pede.
 */
export function needsApproval({ command, computerKind, policy = 'risky', allowed = [] }) {
  if (allowed.some(a => a === command)) return null;
  if (computerKind === 'local') return riskOf(command) || 'roda direto na sua máquina';
  if (policy === 'never') return null;
  if (policy === 'always') return riskOf(command) || 'ação no computador do agente';
  return riskOf(command);
}

/**
 * Pedidos pendentes: cada um é uma promessa que só termina quando o usuário decide
 * (ou quando expira / a conversa é cancelada — nesses casos, a resposta é "negado").
 */
export class ApprovalGate {
  constructor({ timeoutMs = 10 * 60_000, onChange = () => {} } = {}) {
    this.pending = new Map();
    this.timeoutMs = timeoutMs;
    this.onChange = onChange;
  }
  request(record, signal) {
    return new Promise(resolve => {
      const finish = (status, extra) => {
        if (!this.pending.has(record.id)) return;
        clearTimeout(timer);
        this.pending.delete(record.id);
        Object.assign(record, { status, decidedAt: Date.now(), ...extra });
        this.onChange(record);
        resolve(record);
      };
      const timer = setTimeout(() => finish('expired'), record.timeoutMs || this.timeoutMs); // perguntas esperam mais que aprovações
      signal?.addEventListener('abort', () => finish('cancelled'), { once: true });
      this.pending.set(record.id, finish);
      this.onChange(record);
    });
  }
  decide(id, approved, extra = {}) {
    const finish = this.pending.get(id);
    if (!finish) return false;
    finish(approved ? 'approved' : 'denied', extra);
    return true;
  }
}
