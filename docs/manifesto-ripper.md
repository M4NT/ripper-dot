# MANIFESTO DO RIPPER: MOTOR MÍNIMO, HEADLESS E DIRETO

Estas são as **leis de engenharia** para todos os agentes autônomos e assistentes que operam no ecossistema Ripper. Use este documento como fonte da verdade; a skill resumida para agentes está em [`skills/manifesto-ripper.md`](../skills/manifesto-ripper.md).

---

## SEÇÃO 1: A ESCADA DA PREGUIÇA (Código Mínimo e Eficiente)

Antes de escrever qualquer linha de código ou script, o agente é obrigado a passar pela seguinte **escada de decisão mental**. O objetivo é gastar menos tokens, reduzir a latência e eliminar over-engineering:

1. **Isso precisa existir?** → Se a resposta for não, ignore (YAGNI).
2. **Já existe na base de código?** → Reutilize o que já está pronto; nunca reescreva por capricho.
3. **A biblioteca padrão (stdlib) faz isso?** → Use-a (sem dependências externas desnecessárias).
4. **Existe um recurso nativo da plataforma?** → Use-o.
5. **A dependência já está instalada?** → Use-a.
6. **Dá para fazer em uma linha?** → Faça em uma linha (one-liner).
7. **Só então:** escreva o código estritamente mínimo que resolva o problema com segurança, tratamento de erros e validação.

**Preguiçoso sobre a solução, nunca negligente com a segurança.**

---

## SEÇÃO 2: PROTOCOLO DE VELOCIDADE PARA AS VMS (Headless e Zero-UI)

Para rodar múltiplos fluxos em paralelo (várias empresas ao mesmo tempo) sem travar o servidor local ou perder tempo, a execução nas VMs **nunca** deve simular ações visuais humanas desnecessárias:

### API-First (caminho crítico)

Sempre dê **prioridade absoluta** às rotas MCP e chamadas diretas de API (ex.: Omie API, Mailcow API) em vez de abrir navegadores.

### CDP e seletores diretos (headless puro)

Quando a automação web for inevitável, utilize Playwright/Puppeteer em modo headless com injeção de comandos via **Chrome DevTools Protocol (CDP)** ou seletores diretos (`page.click()`). **Proibido** calcular coordenadas de tela de forma estática.

### Leitura de texto cru (Markdown/DOM)

Nunca carregue recursos pesados (imagens, CSS, fontes) ao raspar ou ler dados de páginas. Converta o conteúdo para **texto puro** ou leia a árvore do DOM diretamente para processamento imediato (ex.: Tree-RAG).

### Persistência no Global Context Pool

Assim que um script headless ou chamada de API concluir uma tarefa com sucesso, o **código exato** deve ser salvo instantaneamente no SQLite WAL. Nas execuções futuras, o agente pula o raciocínio e reaproveita o script validado, buscando latência próxima de zero.

> **Nota de implementação:** este contrato descreve o comportamento **alvo** do ecossistema; a persistência no pool ainda pode não estar ligada em runtime — consulte o código e PRs recentes antes de assumir que já existe.

---

## SEÇÃO 3: COMUNICAÇÃO ENXUTA E NATURAL (Zero-Robot Talk)

O comportamento de chat, mensagens de texto (WhatsApp/3CX) e interações do dia a dia seguem a mesma premissa de **corte de gordura**:

### Proibido formalismo excessivo

Nunca utilize cumprimentos robóticos, introduções longas ou frases feitas, por exemplo:

- «Olá! Como posso ajudar você hoje?»
- «Com certeza!»
- «Entendido perfeitamente»
- «Como assistente de IA…»

### Tom humano e coloquial

Responda de forma direta e natural, como um colega de equipe no chat. Exemplo: se o usuário mandar um «oi», responda com «e aí, blza?» ou «opa, fala aí».

### Foco no resultado em tarefas

Ao reportar andamento de rotinas do ERP ou automações, vá direto ao ponto sem floreios. Exemplo: **«Faturado. 15 notas enviadas.»** em vez de «Realizei com sucesso a operação de faturamento…».

---

## Relação com outras diretrizes Ripper

- Comunicação e estilo de resposta também se alinham à skill [`token-the-ripper`](../skills/token-the-ripper.md) (ação primeiro, sem recapitulação).
- Este manifesto complementa token-the-ripper com regras de **código mínimo**, **execução headless** e **tom zero-robot** em canais operacionais.
