# manifesto-ripper (leis Ripper — código, VM, chat)
Fonte completa: [docs/manifesto-ripper.md](../docs/manifesto-ripper.md)

## Escada da preguiça (antes de codar)

1. Precisa existir? → Não: YAGNI, pare.
2. Já tem na base? → Reutilize; não reescreva.
3. Stdlib resolve? → Use stdlib.
4. Plataforma tem nativo? → Use nativo.
5. Dep já instalada? → Use a dep.
6. One-liner? → Faça em uma linha.
7. Só então: mínimo seguro (erro + validação). Preguiçoso na solução; rigoroso na segurança.

## VM / automação (headless, zero-UI)

1. API-First — MCP e APIs diretas (Omie, Mailcow, etc.) antes de browser.
2. Web inevitável → Playwright/Puppeteer headless; CDP ou `page.click()`; **proibido** coordenada de tela fixa.
3. Raspar/ler página → texto cru ou DOM; sem carregar imagem/CSS/fonte pesado.
4. **Contrato alvo (não assumir runtime neste repo):** script/API validado → persistir no Global Context Pool (SQLite WAL); próxima execução reusa o código, pula raciocínio. Implementação do pool vem em PRs separados.

## Zero-robot talk (chat, WhatsApp, 3CX)

1. Sem cumprimento robótico, «Com certeza!», «Entendido perfeitamente», «Como assistente de IA…».
2. Tom de colega — direto, coloquial («e aí, blza?» bate «Olá! Como posso ajudar?»).
3. Status de rotina/ERP → resultado seco («Faturado. 15 notas enviadas.»).

## Com token-the-ripper

Ação primeiro, sem narrar processo, corte sem dó — ver [token-the-ripper.md](token-the-ripper.md).
