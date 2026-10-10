/**
 * Provedor de modelo só para testes (ativado com RIPPER_TEST_PROVIDER no ambiente do servidor).
 * Não chama Anthropic/OpenAI. Cenários:
 *   stream (padrão) — tokens em pedaços determinísticos
 *   slow — mesma resposta, com pausa entre tokens (abortar no meio)
 *   fail — erro antes de qualquer texto
 *   approve — pede aprovação de um comando (Aprovar/Negar) e responde conforme a decisão
 *   ask — chama a ferramenta ask_owner de verdade e responde com a resposta do usuário
 *   setting — oferece o interruptor do resumo diário (offer_setting) e responde com o resultado
 *   genui — mostra um cartão de pergunta do catálogo (show_question)
 *   genui_draft — rascunho editável (show_draft_message)
 *   genui_setting — interruptor que o clique aplica (show_setting)
 *   genui_html — prévia HTML grande (para o SSE leve)
 *   genui_fence — responde com um bloco ```genui (id registrado no servidor)
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
export async function* runTestProvider({ prompt, signal, ctx }) {
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
    for (const tool of ['WebSearch', 'WebFetch', 'shell']) {
      yield { tool, detail: `teste ${tool}` };
      await delay(150, signal);
    }
    for (const part of text.match(/.{1,6}/gs) || []) { yield { text: part }; await delay(20, signal); }
    return;
  }

  if (mode === 'notes') {
    // Agente real: rascunho antes da ferramenta ("Now implementing…") e a resposta depois.
    const say = async function* (s) { for (const part of s.match(/.{1,5}/gs) || []) { yield { text: part }; await delay(25, signal); } };
    yield* say('Now implementing: check the file.');
    yield { tool: 'WebSearch', detail: 'teste' };
    await delay(300, signal);
    yield* say('Pronto: o arquivo está certo.');
    return;
  }

  if (mode === 'ask' && ctx?.askOwner) {
    yield { tool: 'ask_owner', detail: 'Qual cliente?' };
    const out = await ctx.askOwner({ question: 'Qual cliente devo usar?', context: 'Há dois com o mesmo nome.', options: ['Ana Ltda', 'Ana ME'] });
    yield { text: `Ok. ${out}` };
    return;
  }

  if (mode === 'approve' && ctx?.askApproval) {
    yield { tool: 'shell', detail: 'rm -rf dist' }; // sem Computador ligado: não fingir "no computador"
    const ok = await ctx.askApproval('rm -rf dist', 'teste de aprovação');
    yield { text: ok ? 'comando aprovado' : 'comando negado' };
    return;
  }

  if (mode === 'setting' && ctx?.offerSetting) {
    yield { tool: 'offer_setting', detail: 'Resumo diário' };
    const out = await ctx.offerSetting({ key: 'pulse.enabled', on: true, reason: 'Assim você recebe um resumo do dia.' });
    yield { text: out };
    return;
  }

  if (mode === 'genui' && ctx?.showUi) {
    yield { tool: 'show_question', detail: 'Qual cliente?' };
    const out = await ctx.showUi('question', {
      prompt: 'Qual cliente devo usar?',
      options: [{ id: 'ana', label: 'Ana Ltda' }, { id: 'me', label: 'Ana ME' }],
      allowOther: true
    });
    yield { text: out || 'Escolha no cartão acima.' };
    return;
  }

  if (mode === 'genui_draft' && ctx?.showUi) {
    yield { tool: 'show_draft_message', detail: 'Proposta' };
    const out = await ctx.showUi('draft_message', {
      channel: 'email',
      to: 'ana@loja.com',
      subject: 'Proposta',
      body: 'Olá Ana, segue a proposta original.'
    });
    yield { text: out || 'Revise o rascunho.' };
    return;
  }

  if (mode === 'genui_setting' && ctx?.showUi) {
    yield { tool: 'show_setting', detail: 'Resumo no WhatsApp' };
    const out = await ctx.showUi('setting', {
      key: 'pulse.whatsapp',
      label: 'Resumo diário no WhatsApp',
      description: 'O resumo também chega no WhatsApp.',
      proposed: true
    });
    yield { text: out || 'Ligue pelo cartão.' };
    return;
  }

  if (mode === 'genui_html' && ctx?.showUi) {
    yield { tool: 'show_html_preview', detail: 'Cartão' };
    const html = `<article><h1>Ana</h1><p>${'x'.repeat(20_000)}</p></article>`;
    const out = await ctx.showUi('html_preview', { title: 'Cartão de visita', html });
    yield { text: out || 'Prévia acima.' };
    return;
  }

  if (mode === 'genui_fence') {
    yield { text: 'Aqui o cartão:\n\n```genui\n{"component":"question","props":{"prompt":"Qual tom?","options":[{"id":"a","label":"Formal"},{"id":"b","label":"Leve"}]}}\n```\n' };
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
