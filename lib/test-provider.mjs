/**
 * Provedor de modelo só para testes (ativado com RIPPER_TEST_PROVIDER no ambiente do servidor).
 * Não chama Anthropic/OpenAI. Cenários:
 *   stream (padrão) — tokens em pedaços determinísticos
 *   slow — mesma resposta, com pausa entre tokens (abortar no meio)
 *   fail — erro antes de qualquer texto
 *
 * Opcional no prompt: prefixo [[ripper:test:<cenário>]] sobrescreve o env por requisição.
 */

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error('aborted'));
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    }, { once: true });
  });
}

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

  if (mode === 'team') {
    let payload = null;
    for (const m of text.matchAll(/\{[\s\S]*?"agents"\s*:\s*\[[\s\S]*?\}[\s\S]*?\}/g)) {
      try {
        JSON.parse(m[0]);
        payload = m[0];
        break;
      } catch { /* exemplo no system prompt não é JSON válido */ }
    }
    if (!payload) {
      payload = JSON.stringify({
        title: 'Time de teste',
        agents: [
          { key: 'coord', name: 'Coordenador', description: 'Orquestra entregas.', category: 'Produtividade' },
          { key: 'exec', name: 'Executor', description: 'Executa tarefas.', category: 'Operações', managerKey: 'coord' }
        ],
        inboxLinks: [{ fromKey: 'coord', toKey: 'exec', kind: 'delegate', note: 'Tarefas operacionais' }]
      });
    }
    yield { text: payload };
    return;
  }

  if (mode === 'tools') {
    // Igual a um agente real usando ferramentas: a UI mostra a linha de ações (onde o ThinkingOrb já quebrou a tela).
    for (const tool of ['WebSearch', 'WebFetch', 'computer_exec']) {
      yield { tool, detail: `teste ${tool}` };
      await delay(150, signal);
    }
    for (const part of text.match(/.{1,6}/gs) || []) { yield { text: part }; await delay(20, signal); }
    return;
  }

  if (mode === 'fail') {
    throw new Error('provedor mock falhou antes do texto');
  }

  const chunks = mode === 'slow'
    ? ['par', 'te ', '1', '...', ' ', 'ok']
    : (text.match(/.{1,4}/g) || [text]);

  const pause = mode === 'slow' ? 120 : 0;

  for (const c of chunks) {
    if (signal?.aborted) return;
    if (pause) {
      try { await delay(pause, signal); } catch { return; }
    }
    if (signal?.aborted) return;
    yield { text: c };
  }
}
