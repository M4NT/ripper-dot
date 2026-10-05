// X9 Guard: filtro de saída. Antes de qualquer envio para fora (WhatsApp, e-mail, publicação), mascara
// segredos e dados sensíveis que o agente tenha colocado no texto por engano. Preciso de propósito:
// mensagens para clientes têm números de pedido e links longos legítimos — só pega o que é sensível com certeza.
const PATTERNS = [
  ['chave de API', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g],
  ['token do GitHub', /\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}\b/g],
  ['chave da AWS', /\bAKIA[0-9A-Z]{16}\b/g],
  ['chave do Google', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['token Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['token de acesso', /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi],
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  // "senha: xyz", "password = xyz", "token: xyz" — só o valor é mascarado
  ['senha', /\b((?:senha|password|passwd|pwd|token|api[_ -]?key|secret|segredo)\s*[:=]\s*)(["']?)([^\s"',;]{4,})\2/gi]
];
const MASK = '••••';

/** Luhn: número de cartão válido? */
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * text: o que vai sair. known: valores exatos dos segredos salvos no Ripper (chaves, senhas, tokens).
 * Devolve { text: mascarado, findings: ['chave de API', …] } — nunca devolve o valor encontrado.
 */
export function guardOutbound(text, known = []) {
  let out = String(text ?? '');
  const findings = new Set();
  for (const k of known) {
    if (typeof k === 'string' && k.length >= 6 && out.includes(k)) { out = out.split(k).join(MASK); findings.add('segredo salvo no Ripper'); }
  }
  for (const [name, re] of PATTERNS) {
    out = out.replace(re, (m, pre, q, val) => { findings.add(name); return name === 'senha' ? `${pre}${q}${MASK}${q}` : MASK; });
  }
  out = out.replace(/\b(?:\d[ -]?){12,18}\d\b/g, m => {
    const d = m.replace(/\D/g, '');
    // prefixo de bandeira real: 1 em cada 10 números longos (pedidos, protocolos) passaria só no Luhn
    if (d.length < 13 || d.length > 19 || !/^(4|5[1-5]|2[2-7]|3[47]|6)/.test(d) || !luhn(d)) return m;
    findings.add('número de cartão');
    return `${MASK} ${d.slice(-4)}`;
  });
  return { text: out, findings: [...findings] };
}
