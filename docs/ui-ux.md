# Auditoria de UI/UX — 07/10/2026

Base: `main` em 8888983, build de produção, servidor isolado (`RIPPER_TEST_PROVIDER=tools`, dados em pasta temporária), Firefox headless via Playwright (mesmo login por `?token=` do `scripts/ui-smoke.mjs`).
Conteúdo semeado: 6 agentes (Assistente padrão + Ripper, Donald, Júlia, Analista Financeiro, Pesquisa de Mercado), projeto "Lançamento Loja Online" com conversa em grupo de 3, conversa 1:1 com ferramentas, pedido de aprovação (`rm -rf dist`), @menção, 2 rotinas, 3 arquivos. Modo Enterprise ligado.
Telas: chat 1:1, grupo, Início, Caixa, Agentes, ficha do agente, novo agente, Fluxos, Projetos, projeto, Biblioteca, Conversas, Marketplace, Conectar aplicativos, Conectores, Saúde, Ajuda, Explorar, Configurações (10 abas), login/setup, primeiro uso — em 375, 1280 e 1440, escuro e claro.
Prints em `docs/ui-ux/<tela>-<largura>-<tema>.png` (1280 e 375 no escuro; 1280 no claro; 1440 só nas telas principais).

Checagem automática (todas as telas × 3 larguras × 2 temas): **nenhuma rolagem lateral na página** e nenhuma tela "Algo quebrou". O streaming não foi avaliado (requestAnimationFrame não roda de forma confiável sem tela); "Escrevendo…" nos prints é o momento da captura, não travamento.
Obs.: textos com `[[ripper:test:…]]` nos prints são o prefixo do provedor de teste, não bug do produto.

## P0 — quebra o uso ou a confiança

1. **Primeiro uso nunca aparece.** `lib/store.mjs:241` cria o "Assistente" quando não há agentes, e `web/src/firstRunWizard.jsx:19` só abre com `S.agents.length === 0`. Numa instalação nova a pessoa cai direto no chat, sem escolher a IA nem o computador — e a Saúde mostra "Claude · Sem login" em vermelho.
   Print: `docs/ui-ux/wizard-1280-dark.png`, `wizard-375-dark.png`.
   Correção: abrir o assistente pelo `ripper.onboarded` + "nenhum provedor conectado" (não pela contagem de agentes), ou marcar o agente padrão como `seed: true` e ignorá-lo na condição.

2. **Bandeja de aprovação cobre a tela.** O cartão flutuante "1 pedido aguardando sua aprovação" fica fixo no canto em todas as telas, por cima do campo de mensagem, de cards de agentes, do formulário da ficha e até do aviso "Agentes podem errar". No celular ocupa metade da tela e o "Recusar" cai para uma terceira linha.
   Print: `grupo-1280-dark.png`, `agentes-1280-dark.png`, `agente-config-1280-dark.png`, `agentes-375-dark.png`.
   Correção: começar recolhida (só a pílula âmbar "1 aprovação" acima do campo de mensagem, como a Caixa já faz); expandir por clique; nunca sobrepor o composer (`bottom` acima da altura do composer). No celular, folha inferior com os 3 botões em uma linha (`Recusar` como botão de ícone ou texto curto) e fechada por padrão. Não mostrar a bandeja quando o mesmo pedido já está visível no fio aberto.

3. **"Copiar" e "Ouvir" quebram letra por letra no celular.** Na linha de ações da resposta, a 375px, o rótulo vira "Co/pi/ar", "O/u/vir" e o horário "09:/28".
   Print: `chat-1a1-375-dark.png`.
   Correção: nessa linha usar só ícone abaixo de 480px (com `aria-label`) e `white-space: nowrap; flex-shrink: 0` nos botões; o horário com `nowrap`.

4. **Estado contraditório sobre a IA e o computador.** Configurações → Provedores mostra Claude com selo verde "assinatura", enquanto Saúde diz "Claude · Sem login" (vermelho). No chat, a pílula diz "Sem computador" e a atividade da resposta diz "Rodando no computador".
   Print: `config-models-1280-dark.png`, `saude-1280-dark.png`, `chat-1a1-1280-light.png`.
   Correção: uma fonte única de estado por provedor (`conectado` / `sem login` / `fora do ar`), usada no selo e na Saúde; selo âmbar "falta entrar" com botão "Entrar" quando sem login. Rótulo da atividade sem computador: "Rodando aqui no Ripper" (ou o nome real do ambiente).

## P1 — parece inacabado

5. **Saúde sem ação.** Linha vermelha "Claude · Sem login" e linhas cinza "Desligado" não têm botão; a única ação é "Baixar relatório de erro".
   Print: `saude-1280-dark.png`.
   Correção: cada linha não verde ganha um botão à direita ("Entrar", "Ligar WhatsApp", "Configurar e-mail") que abre a aba certa de Configurações.

6. **Jargão e inglês em telas de usuário.** Marketplace: "Enterprise hub", "Templates advisory · Hub Architect", "trade-offs", "Issues", "plugins e Bots". Provedores: "Roteador local", "cursor-agent", "Antigravity", "Codex". Conectores: "Servidores MCP personalizados". Cards de agente e balões: "~91 tokens · ~US$ 0,00", "Claude Fable 5.1 · Baixo".
   Print: `marketplace-1280-dark.png`, `config-models-1280-dark.png`, `agentes-1280-dark.png`, `grupo-1280-dark.png`.
   Correção: trocar por PT-BR simples ("Modelos de time", "Montar um time", "tarefas, projetos e ciclos", "Buscar aplicativos e agentes", "Conexões avançadas"); tirar tokens/custo/modelo do card e do rodapé do balão — mostrar só ao abrir "detalhes" (regra de §3.1: detalhes técnicos só quando a pessoa abre o item).

7. **Texto cortado em selos e nomes fixados.** Na lateral, o selo "Grupo" vira "Grup…" e o título do grupo "Pessoal, preciso …"; nos fixados, "Pesquisa de …", "Analista Fina…". O título da bandeja corta o nome da conversa no meio ("[[…]] Verifique (").
   Print: `chat-1a1-1280-dark.png`, `grupo-1280-dark.png`.
   Correção: selo de grupo como ícone (pessoas) sem texto, `flex-shrink: 0`; nome fixado em até 2 linhas com `line-clamp: 2` e fonte 12px; na bandeja, título da conversa em linha própria com reticências no fim.

8. **Login/setup fora do padrão.** Ordem dos campos: Senha → Código de configuração → Repita a senha (o código separa a senha da confirmação). O logo é serifado itálico, diferente do "R" + Geist do app; botão com canto ~8px, diferente das pílulas.
   Print: `login-1280-dark.png`, `login-375-dark.png`.
   Correção: Código primeiro (com a dica do arquivo), depois Senha e Repita a senha; usar o mesmo logo do app; botão em pílula (`--radius` 999px) como os demais.

9. **Configurações no celular perdem a navegação.** A lista de abas vira faixa horizontal ao lado da busca e mostra só "Perfil" e um pedaço de "Pr…"; não há indicação de que rola. Os botões de "Tom" ficam cortados na borda.
   Print: `config-profile-375-dark.png`.
   Correção: no celular, primeira tela = lista de abas (como o desktop, com ícones e dicas) e cada aba abre com "← Configurações"; pílulas de opção quebram em linhas (`flex-wrap: wrap`).

10. **Filtros cortados no celular (Agentes).** "Todos · Online · Pausados · Trab…" rola sem sinal visual.
    Print: `agentes-375-dark.png`.
    Correção: reduzir para "Todos / Trabalhando / Pausados" (Online repete Todos quando tudo está ativo) ou adicionar degradê de borda indicando rolagem.

11. **"Conectar aplicativos" abre "Marketplace".** O botão fixo da lateral promete conectar apps e abre uma janela chamada Marketplace com "Enterprise hub" no topo; "Google Agenda" e "Notion" aparecem duas vezes (Para você e Em destaque).
    Print: `marketplace-1280-dark.png`, `conectar-apps-375-dark.png`.
    Correção: título da janela "Conectar aplicativos"; primeira seção = apps conectáveis; remover a duplicação (Em destaque sem os itens já em Para você); "Architect" vai para "Novo agente → Montar um time".

12. **Escrever enquanto há aprovação pendente parece ignorado.** Com o turno esperando "Aprovar", a mensagem "@Donald confirme…" ficou no campo e o botão virou "parar" sem explicação.
    Print: `chat-1a1-1280-dark.png`.
    Correção: aviso no composer "Esperando sua aprovação acima — sua mensagem vai depois" e permitir enfileirar (casa com o P1 de `docs/interacao-agentes.md` §1).

13. **Estados vazios inconsistentes.** Fluxos tem cartão com título, texto e botão; Biblioteca → Artefatos mostra uma frase solta sem ação; "Scripts" e "Mensagens" não têm contador, os outros têm.
    Print: `fluxos-1280-dark.png`, `biblioteca-1280-dark.png`.
    Correção: usar o mesmo componente de vazio do Fluxos em todas as abas; contador em todas ou em nenhuma.

## P2 — acabamento

14. **Semáforo de autonomia sem rótulo.** Nos cards de Agentes há um ícone de 3 luzes sem texto nem tooltip; na ficha aparece "Semi-autônomo". Print: `agentes-1280-dark.png`. Correção: `title`/`aria-label` "Autonomia: semi-autônomo" e o mesmo texto curto ao lado no card.
15. **Mascote do Assistente achatado.** Em várias capturas o avatar fixado aparece oval (animação de "trabalhando" pega no meio do quadro). Print: `agente-config-1280-dark.png`, `fluxos-1280-dark.png`. Correção: animar com `transform: scale` uniforme ou leve `translateY`, nunca escala só em Y; desligar com `prefers-reduced-motion`.
16. **Contraste no tema claro.** O contador da Caixa (âmbar escuro com número escuro) fica pouco legível no claro. Print: `chat-1a1-1280-light.png`. Correção: no claro, fundo âmbar `#f5a524` com texto `#1a1a1a` (≥ 4.5:1) ou o mesmo selo do escuro.
17. **Cabeçalho duplo no celular.** "☰ Ripper 🔍" e logo abaixo "Assistente · Ativo 🔍" — duas buscas e duas linhas de cabeçalho. Print: `chat-1a1-375-dark.png`. Correção: no chat, uma linha só: ☰ + mascote/nome do agente + busca.
18. **Projeto sem objetivo.** "Sem objetivo definido." em cinza sem link para definir. Print: `projeto-1280-dark.png`. Correção: transformar em botão-texto "Definir objetivo".
19. **Linha de ações do balão longa demais.** Hora · tempo · nº de ações · modelo · Copiar · Ouvir · Refazer em todas as respostas. Print: `grupo-1280-dark.png`. Correção: mostrar só hora; o resto aparece ao passar o mouse (desktop) ou tocar no balão (celular).

## O que está bom
- Nenhuma rolagem lateral em nenhuma tela/largura/tema.
- Escuro segue §3.1 (fundo ~#070707, lateral #111, balões #2c2c2c, cantos grandes, pílulas).
- Caixa com atalhos de teclado claros; janela por cima (Marketplace, Configurações, Saúde) fecha e volta ao lugar.
- Cartão de aprovação no fio é claro (comando, motivo, três ações).
