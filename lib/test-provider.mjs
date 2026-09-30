/**
 * Provedor de modelo só para testes (ativado com RIPPER_TEST_PROVIDER no ambiente do servidor).
 * Não chama Anthropic/OpenAI. Cenários:
 *   stream (padrão) — tokens em pedaços determinísticos
 *   slow — mesma resposta, com pausa entre tokens (abortar no meio)
 *   fail — erro antes de qualquer texto
 *
 * Opcional no prompt: prefixo [[ripper:test:<cenário>]] sobrescreve o env por requisição.
 */

const delay = ms => new Promise(r => setTimeout(r, ms));

export function testProviderScenario(prompt) {
  const fromPrompt = /\[\[ripper:test:(\w+)\]\]/.exec(prompt || '');
  if (fromPrompt) return fromPrompt[1].toLowerCase();
  return (process.env.RIPPER_TEST_PROVIDER || 'stream').toLowerCase();
}

export function stripTestDirective(prompt) {
  return String(prompt || '').replace(/\[\[ripper:test:\w+\]\]\s*/g, '').trim();
}

/** @param {{ prompt: string, signal?: AbortSignal }} opts */
export async function* runTestProvider({ prompt, signal }) {
  const mode = testProviderScenario(prompt);
  const text = stripTestDirective(prompt) || 'resposta de teste';

  if (mode === 'fail') {
    throw new Error('provedor mock falhou antes do texto');
  }

  const chunks = mode === 'slow'
    ? ['par', 'te ', '1', '...', ' ', 'ok']
    : (text.match(/.{1,4}/g) || [text]);

  const pause = mode === 'slow' ? 120 : 0;

  for (const c of chunks) {
    if (signal?.aborted) return;
    if (pause) await delay(pause);
    if (signal?.aborted) return;
    yield { text: c };
  }
}
