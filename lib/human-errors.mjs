// Erros em linguagem de gente: o que houve, o que fazer e uma ação de 1 clique.
// Puro (sem Node/DOM): usado pelo servidor e pelo front (import relativo).

/** Esconde segredos antes de mostrar qualquer texto técnico. */
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer ***')
    .replace(/\b(sk|rk|pk)-[\w-]{6,}/g, '$1-***')
    .replace(/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[\w]{6,}/g, '$1_***')
    .replace(/\bAIza[\w-]{10,}/g, 'AIza***')
    .replace(/\b(xox[abpr])-[\w-]{6,}/g, '$1-***')
    .replace(/((?:api[_-]?key|apikey|token|password|senha|secret)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1***')
    .replace(/\s+at\s+\S+\s+\([^)]*\)/g, '') // linhas de stack trace
    .trim()
    .slice(0, 1500);
}

// [regex, título, dica, ação]. A ordem importa: o primeiro que casa vence.
const RULES = [
  [/uso pago n[ãa]o autorizado|paid.?usage.?(disabled|not)/i, 'O uso pago está desligado.', 'Este modelo gasta créditos da sua conta. Autorize em Provedores de IA ou use a assinatura.', 'paid-usage'],
  [/limite di[áa]rio de uso pago|daily.?(spend|limit)/i, 'O limite diário de gasto foi atingido.', 'Volta amanhã, ou aumente o limite em Provedores de IA.', 'paid-usage'],
  [/context.{0,20}(too long|length|window)|prompt is too long|too many tokens|maximum context/i, 'A conversa ficou longa demais para o modelo.', 'Comece uma conversa nova ou peça um resumo do que já foi feito.', null],
  [/too large|payload too|file.{0,20}(size|big)|arquivo (muito )?grande|413/i, 'O arquivo é grande demais.', 'Envie um arquivo menor ou divida em partes.', null],
  [/model.{0,40}(not.?found|não.?encontrad|unavailable|indispon)|invalid.?model|not_found_error/i, 'Este modelo não está disponível na sua conta.', 'Troque o modelo ou desligue-o em Provedores de IA.', 'settings-providers'],
  [/docker|daemon|computador (do agente )?indispon|container/i, 'O computador dos agentes está desligado.', 'Abra o Docker Desktop nesta máquina e tente de novo.', 'settings-computer'],
  [/whats.?app|evolution|instance.{0,20}(close|disconnect)/i, 'O WhatsApp está desconectado.', 'Escaneie o QR code de novo em Canais.', 'settings-channels'],
  [/imap|smtp|e-?mail.{0,30}(auth|login|senha)|invalid credentials.{0,20}mail/i, 'Não deu para entrar no e-mail.', 'Confira o e-mail e a senha de app em Canais.', 'settings-channels'],
  [/github|ghp_|bad credentials/i, 'O token do GitHub não vale mais.', 'Gere um token novo e cole em Canais.', 'settings-channels'],
  [/claude.{0,20}(login|logged|auth)|not logged in|please run \/?login|oauth.{0,20}(expired|token)|credentials? expired/i, 'A assinatura do Claude saiu desta máquina.', 'Entre de novo na sua conta do Claude.', 'reconnect-claude'],
  [/\b40[13]\b|unauthori|forbidden|invalid.{0,10}(api.?key|x-api-key)|incorrect api key|authentication_error|permission_error/i, 'A chave do provedor foi recusada.', 'Confira a chave de API em Provedores de IA.', 'settings-providers'],
  // só textos do Claude Code: "hit your usage limit" sozinho também é do Codex e cai na regra genérica abaixo
  [/session limit|weekly limit|claude ai usage limit/i, 'A assinatura do Claude chegou ao limite.', 'Ela volta no horário que aparece nos detalhes ("resets"). Se você tem outra conta (ex.: Teams), conecte em Contas do Claude e o Ripper continua por ela sozinho.', 'claude-accounts'],
  [/out of (usage )?credits|credit balance|insufficient.?(credits|funds|balance)|sem cr[ée]ditos?/i, 'Os créditos deste provedor acabaram.', 'Recarregue os créditos na conta do provedor ou escolha outro modelo em Provedores de IA.', 'settings-providers'],
  [/\b429\b|rate.?limit|usage.?limit|quota|limite de uso|too many requests|\blimit\b/i, 'O limite de uso foi atingido.', 'Espere alguns minutos e tente de novo, ou escolha outro modelo.', 'retry'],
  [/sess[ãa]o (expirou|expirada)|session expired|fa[çc]a login|log ?in again|redirect.{0,20}login/i, 'A sessão no site expirou.', 'Entre de novo no site e peça para o agente continuar.', 'open-inbox'],
  [/overloaded|\b5\d\d\b|bad gateway|service unavailable|internal server error/i, 'O provedor do modelo está fora do ar agora.', 'Costuma voltar em instantes: tente de novo.', 'retry'],
  [/timeout|timed out|tempo esgotado|ETIMEDOUT|ESOCKETTIMEDOUT/i, 'Demorou demais para responder.', 'Tente de novo; pedidos menores respondem mais rápido.', 'retry'],
  [/ECONNREFUSED/i, 'O serviço recusou a conexão.', 'Ele parece desligado nesta máquina: abra o programa (ou o Docker) e tente de novo.', 'retry'],
  [/oauth|invalid_grant|refresh.?token/i, 'A conexão com o serviço expirou.', 'Reconecte o conector em Canais e peça de novo.', 'settings-channels'],
  [/ENOTFOUND|ECONN|EAI_AGAIN|fetch failed|network|socket hang up|sem conex/i, 'Sem conexão com o serviço.', 'Confira a internet desta máquina e tente de novo.', 'retry'],
  [/\bmcp__\w+|\btoolu_\w+|tool_use_id|tool (call|use).{0,20}(fail|error)|ferramenta .{0,30}falhou/i, 'Uma ferramenta do agente falhou.', 'Peça de novo; se repetir, confira o conector usado em Canais.', 'retry'],
  [/codex/i, 'O Codex não respondeu.', 'Confira se o Codex está instalado e logado (codex login).', 'settings-providers'],
  [/success: erro|error_during_execution|error_max_turns|max.?turns/i, 'O modelo encerrou sem dar uma resposta.', 'Costuma ser passageiro: tente de novo. Se repetir, troque o modelo.', 'retry']
];

/** explainError(raw) → { title, hint, action, details } — details já vem sem segredos. */
export function explainError(raw) {
  const text = String(raw?.message ?? raw ?? '');
  const details = redactSecrets(text);
  const hit = RULES.find(([re]) => re.test(text));
  if (hit) return { title: hit[1], hint: hit[2], action: hit[3], details };
  return { title: 'Algo deu errado.', hint: 'Tente de novo. Se continuar, veja os detalhes.', action: 'retry', details };
}

/** Destino de cada ação de navegação (hash). 'retry' depende de quem chama. */
export const ERROR_ACTIONS = {
  'reconnect-claude': ['/settings/models', 'Entrar no Claude'],
  'claude-accounts': ['/settings/models', 'Contas do Claude'],
  'settings-providers': ['/settings/models', 'Abrir Provedores de IA'],
  'paid-usage': ['/settings/models', 'Ajustar uso pago'],
  'settings-channels': ['/settings/channels', 'Abrir Canais'],
  'settings-computer': ['/settings/computer', 'Abrir Computador'],
  'open-inbox': ['/inbox', 'Abrir a Caixa']
};
