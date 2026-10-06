# Ripper — Norte e caminho para produção

Última atualização: 06/10/2026. O histórico do que já foi entregue fica em [ENTREGUE.md](ENTREGUE.md).

---

## 1. O norte

**O Ripper é uma equipe de funcionários de IA que trabalha pelo dono, de verdade, o dia inteiro.**
Cada agente tem computador próprio, memória, rotinas, canais (WhatsApp, e-mail, GitHub) e responde por um pedaço do negócio. O dono conversa com um ou com o time todo, aprova o que é arriscado e vê tudo o que foi feito em seu nome.

**Para quem:** empresas (B2B) e pessoas (B2C). **Onde roda:** na máquina do cliente — os dados ficam com ele.
**Um Ripper por pessoa:** cada funcionário tem o seu, na própria máquina (sem login por usuário; senha única protege cada instalação).
**Qual IA:** a pessoa traz a própria conta (Claude, ChatGPT ou chave de API). Quem não tem, usa **modelos locais**, e o Ripper escolhe sozinho o melhor modelo que o computador dela aguenta.
**Celular:** pareado por **QR Code**, no mesmo modelo do Orca ADE.
*(Decisões do dono, 06/10/2026.)*

O objetivo final é **ser melhor que o Grok** naquilo que importa para quem usa IA para trabalhar: **fazer o trabalho, não só responder**.

Princípios que não mudam:
- **A assinatura é o motor principal.** Claude Code e ChatGPT pela assinatura; qualquer coisa que gaste crédito só com consentimento explícito e limite diário.
- **Nada sai em seu nome sem rastro.** Toda ação externa fica registrada; o que é arriscado pede aprovação.
- **Seus dados ficam com você.** Roda na sua máquina; transcrição de áudio local; chaves cifradas.
- **Tudo visível.** Quem está fazendo o quê, agora, em qualquer tela.

---

## 2. Ripper × Grok — onde estamos

Grok de referência: versão 4.6 (agosto de 2026) — agentes de longa duração, quatro agentes em paralelo que conferem a resposta uns dos outros, busca em tempo real no X, geração de imagem e vídeo, Grok Build (cria e publica apps), app de celular, automações, API e complementos de escritório.

| Capacidade | Grok | Ripper hoje | Situação |
|---|---|---|---|
| Conversar, pesquisar, raciocinar | Modelo próprio de ponta | Claude/GPT/Gemini pela assinatura ou chave | Empate (depende do modelo) |
| Agentes trabalhando juntos | 4 agentes internos, invisíveis | Times visíveis, com papéis, @menção, delegação e grupo | **Ripper na frente** |
| Computador próprio por agente | Execução de código no servidor | Contêiner com terminal, navegador que você vê e pode assumir | **Ripper na frente** |
| Trabalhar sozinho (rotinas, gatilhos) | Automações | Horário, webhook, e-mail, palavra no WhatsApp, fluxos com aprovação | **Ripper na frente** |
| Canais do negócio | X | WhatsApp (QR e oficial), e-mail, GitHub | **Ripper na frente** |
| Memória e aprendizado | Memória de conversa | Memória por agente, scripts aprendidos, estilo aprendido | Ripper na frente |
| Segurança e controle | — | Aprovações, autonomia por agente, registro imutável, X9 Guard, limites de gasto | **Ripper na frente** |
| Privacidade | Nuvem da xAI | Local, chaves cifradas, áudio transcrito na máquina | **Ripper na frente** |
| Busca em tempo real em rede social | X nativo | Web geral | Grok na frente |
| Imagem e vídeo | Gera os dois | Não gera | **Grok na frente** |
| Criar e publicar apps | Grok Build | Agentes programam no computador, sem publicar | Grok na frente |
| Celular | App nativo | PWA; fora de casa só com túnel (sem login ainda) | **Grok na frente** |
| Velocidade da 1ª resposta | Rápido | 1,3–2 s com processo pré-aquecido; 1ª mensagem de cada agente fria | Grok na frente |
| Instalar e começar | Abrir o app | Node + Docker + logins; exige conhecimento técnico | **Grok muito na frente** |
| Confiabilidade | Serviço gerenciado | Um processo local; reiniciar corta turnos | **Grok muito na frente** |

**Leitura honesta:** o Ripper já faz mais *trabalho* que o Grok; perde em *produto pronto* — instalar, confiar, usar do celular, gerar mídia.

### O que é "ser melhor que o Grok" (medível)
O Ripper é melhor que o Grok quando, para um dono de negócio:
1. **Termina tarefas de ponta a ponta sem ajuda**: ≥ 80% de um conjunto fixo de 50 tarefas reais (pesquisa + planilha, responder cliente no WhatsApp, revisar PR, relatório do dia) sem o dono precisar intervir além de aprovar.
2. **Começa a responder em menos de 1 s** (1ª palavra, mediana) e nunca perde uma resposta por reinício ou queda.
3. **Instala em menos de 5 minutos**, sem terminal, no Windows e no Mac.
4. **Funciona do celular, fora de casa**, com notificação e aprovação no aparelho.
5. **Gera imagem** (e depois vídeo) dentro das tarefas.
6. **Zero ação externa sem rastro** e zero vazamento de segredo nos envios (auditado).

---

## 3. Caminho para produção — checklist completo

Legenda: **P0** bloqueia o lançamento · **P1** logo depois do lançamento · **P2** melhora contínua · ✅ feito · 🔨 em andamento · [ ] a fazer.
"Produção" aqui = outra pessoa instala e usa o Ripper no dia a dia sem você do lado.

### A. Segurança (P0)
- ✅ **Login com senha única** (decidido em 06/10/2026; um Ripper por pessoa, então não há login por usuário). Pede a senha ao abrir; sessão por cookie seguro; chamadas de dentro dos contêineres dos agentes nunca entram sem a senha; tela de login e "esqueci a senha" (redefinir pelo terminal). Senha criada na primeira abertura (só no próprio computador) ou por `node scripts/senha.mjs`; hash scrypt em `data/auth.json`; cookie HttpOnly + SameSite=Strict (Secure em HTTPS). Sessões em memória: reiniciar o servidor pede a senha de novo.
- ✅ Agentes não usam a API do Ripper de dentro do próprio computador: sem sessão, 401 (o cabeçalho Host não decide mais quem entra; a criação da primeira senha exige o código de configuração impresso no terminal e gravado em `data/setup-code.txt`, apagado após o uso).
- [ ] HTTPS para acesso fora de casa (túnel com login: Cloudflare Tunnel ou Tailscale), com passo a passo dentro do app.
- ✅ Proteção contra CSRF nas rotas que mudam algo: cookie SameSite=Strict + verificação de Origin + recusa de Sec-Fetch-Site cross-site.
- ✅ Limite de tentativas no login: 5 erros bloqueiam por 15 min (por endereço, em memória).
- ✅ Chaves e tokens cifrados no disco e nos backups. ✅ Segredos da Evolution também cifrados (`data/evolution.json`).
- ✅ Aprovações, autonomia por agente, registro imutável de ações externas, X9 Guard nos envios.
- ✅ Revisão de segurança completa antes do lançamento (rotas sem autenticação, uploads, caminhos de arquivo, execução de comandos, MCP de terceiros) — ver [seguranca.md](seguranca.md). Corrigidos: `/metrics` aberto sem `RIPPER_TOKEN` (agora exige login; público só com `RIPPER_METRICS_PUBLIC=1`) e XSS refletido nos callbacks OAuth. Pendências no documento.
- 🔨 Política de permissões dos agentes revisada: rascunho em [seguranca.md](seguranca.md) §4, tirado do que o código aplica. Falta decidir se "somente leitura" vale também para ferramentas de conectores MCP (hoje não vale).

### B. Confiabilidade (P0)
- ✅ Recarregar a página não para o agente; a resposta continua no servidor e fica salva.
- ✅ **Reiniciar o servidor não perde turnos**: retoma sozinho os que só leram/pesquisaram; os que já fizeram algo com efeito fora (enviar, publicar) param com aviso na Caixa.
- 🔨 **Staging que sobrevive a reinício** (docker-compose, dados de exemplo, provedor simulado para smoke). *Engenheiro (Ripper), em andamento.*
- ✅ Servidor como serviço do sistema: `node scripts/service.mjs install` (Windows, macOS, Linux), com vigia que reinicia se cair. [ ] Testar o `install` em máquina real.
- ✅ Atualização sem derrubar o que está rodando: aviso "Nova versão — recarregar" nas abas abertas; `node scripts/service.mjs restart` (ou SIGTERM) para de aceitar turnos, espera os em andamento (até `RIPPER_DRAIN_TURNS_MS`, padrão 2 min; o que passar é retomado depois) e o vigia sobe a versão nova na hora.
- ✅ Backup automático diário, cópia extra em outra pasta, aviso de falha. ✅ Backup manual corrigido (link simbólico criado no Docker derrubava o `tar`; agora fica de fora com aviso). ✅ Teste de restauração automático após cada backup diário (extrai numa pasta temporária e confere o `db.json`; falha vira aviso).
- ✅ Fila de envios com novas tentativas (WhatsApp, e-mail, publicações).
- [ ] Contêineres dos agentes: um por agente e por pasta de trabalho (hoje duas conversas do mesmo agente em pastas diferentes se revezam recriando).
- [ ] Agentes trabalhando no código do Ripper em cópia própria (`/work/repos`), nunca trocando o branch da pasta compartilhada.
- [ ] Branch `ripper/staging` ficou para trás da `main` (06/10/2026) e o `scripts/staging.sh` do Engenheiro está fora do Git: alinhar com ele antes de retomar o staging.
- ✅ Limites de recursos por contêiner (`computer.dockerMemory`/`dockerCpus`, padrão 2g/2) e limpeza de contêineres parados na subida.

### C. Instalação e atualização (P0)
- ✅ **Modelos locais para quem não tem conta de IA** (base): detecta RAM, GPU NVIDIA (nvidia-smi) e Apple Silicon, recomenda o maior Qwen3 que cabe (tabela curta em `lib/local-models.mjs`), detecta o Ollama e baixa com 1 clique mostrando o progresso (Configurações → Ollama); o modelo entra direto nos agentes pelo provedor Ollama já existente. Avaliados llmfit (MIT, binário Rust, `llmfit recommend --json`) e whichllm (MIT, Python, notas de benchmark do HF): ficou a ideia do llmfit sem embutir código. Falta: instalar o Ollama pelo Ripper, AMD/Intel GPU, chamar o llmfit se instalado.
- [ ] **Instalador para Windows e Mac** que traz Node, cria o serviço e abre o app — sem terminal. *(Windows feito: `scripts\instalar-windows.cmd`; falta Mac.)*
- ✅ Assistente de primeiro uso: conta do Claude (login), Docker (detecta e orienta), primeiro agente em 1 frase, WhatsApp opcional.
- ✅ Funcionar sem Docker (modo "sem computador" claro, com o que o agente perde).
- ✅ Assistente de primeiro uso pergunta "Você tem conta de IA?" → Claude / ChatGPT / chave de API / "não tenho" (modelo local), explicando o que muda em qualidade. *("Não tenho" aponta para o modelo recomendado em Configurações → Ollama.)*
- ✅ Atualização pela interface com notas da versão: confere a cada 6 h, avisa na Caixa, Configurações › Backup mostra as novidades e "Atualizar agora" (só avança; recusa se houver mudança local; como serviço, reinicia sozinho). [ ] Testar uma atualização de verdade numa instalação.
- ✅ Desinstalar limpo: `scripts/desinstalar-windows.cmd` (ou `node scripts/desinstalar.mjs`) tira o serviço e os computadores dos agentes e mantém os dados; `--apagar-dados` apaga após digitar APAGAR. [ ] Testar numa máquina real.
- [ ] Imagem dos agentes baixada pronta (registro de imagens), sem reconstruir na máquina.

### D. Dados, LGPD e termos (P0)
- ✅ Exclusão de dados pessoais, mascaramento antes do modelo, retenção automática.
- 🔨 Termos de uso e política de privacidade (o que fica na máquina, o que vai para os provedores): **rascunho** em [termos-de-uso.md](termos-de-uso.md) e [politica-de-privacidade.md](politica-de-privacidade.md). [ ] Revisão jurídica.
- 🔨 Aviso de uso de contas de terceiros (assinatura pessoal × Teams da empresa): **rascunho** nos termos de uso. [ ] Revisão jurídica. ✅ Aviso mostrado no app ao adicionar conta (Configurações → Conta do Claude).
- ✅ Exportar tudo: `GET /api/data/export-all` (.tar.gz com conversas em Markdown, agentes + instruções, rotinas, arquivos, artefatos; sem segredos) e botão em Segurança → LGPD.
- ✅ Registro de consentimento para WhatsApp de clientes (número, data, como foi obtido) no Canal WhatsApp; "Exigir consentimento" (opt-in) rebaixa resposta automática a rascunho para quem não tem registro.

### E. Qualidade e testes (P0)
- ✅ ~620 testes automáticos rodando.
- ✅ Testes que sobem o servidor estáveis em máquina carregada (espera pelo /api/health até 60 s, porta livre do sistema).
- [ ] **Smoke diário automático** (Quinn no staging): checklist de 10 fluxos, relatório na Caixa.
- [ ] Testes de interface ponta a ponta (enviar mensagem, aprovar, criar agente, grupo, rotina).
- ✅ CI no GitHub a cada push e PR (testes, build, teste das telas). [ ] Bloqueio de merge com teste falhando (o CI já falha; falta o dono marcar o check `test-and-build` como obrigatório em Settings → Branches). ✅ Teste instável achado: uso por conta dependia do login do Claude na máquina (passava no PC, falhava no CI).
- [ ] `.gitattributes` (fins de linha) num commit isolado.
- [ ] Conjunto fixo de 50 tarefas reais para medir "termina sozinho" (critério 1 do norte).

### F. Desempenho e custo (P1)
- ✅ Processo pré-aquecido (1ª palavra 1,3–2 s), cache de prompt, rota rápida para conversa curta, envio instantâneo no chat.
- [ ] 1ª palavra < 1 s na mediana. ✅ Abrir a conversa reaquece o processo do agente (e o marca como recente no limite de 3). [ ] O 1º turno de cada agente após o servidor subir ainda é frio (o aquecimento reaproveita a configuração do último turno).
- [ ] Prompt de sistema enxuto (medir por agente e cortar o que não é usado).
- [ ] Memória do servidor sob controle com muitos agentes: ✅ processos pré-aquecidos limitados a 3 (sai o menos recente, inclusive ao abrir conversas). [ ] Contêineres.
- [ ] Custo em R$ e previsão de fim de mês.

### G. Experiência de uso (P1)
- ✅ Revisão de todas as telas (06/10/2026): navegação enxuta, chat limpo, busca de configurações, páginas sem rolagem dupla.
- 🔨 "Conversa em grupo" no modo Simples e quem está trabalhando com autocompletar do @. *Donald.*
- ✅ **Interface nova estilo mensageiro** (06/10/2026, referência: Grok Bot): tema escuro neutro como padrão; barra lateral de agentes com fixados no topo; **um agente = uma conversa** (as antigas juntadas, arquivadas, nada apagado); arrastar na mão para fixar e reordenar, com a grade se reorganizando; soltar um agente na conversa marca ele (botão com o mascote); Início vira a conversa; Marketplace ("Conectar aplicativos") e Configurações como janelas por cima.
- ✅ Repaginar no padrão novo as telas que só herdaram as cores (06/10/2026): Caixa, Agentes, Fluxos, Projetos e Biblioteca com a linguagem da conversa (cartões cinza sem contorno, cantos 22, pílulas, listas como as da lateral, título menor; cor só para estado). Classe `.page.v2` em `styles.css`. A bandeja flutuante de aprovações some na Caixa (tudo já está na tela).
- ✅ **Marcar um agente numa conversa 1:1 traz ele para a conversa** (06/10/2026): o @Nome chama o agente naquela rodada e ele responde ali, sem virar grupo; o @ autocompleta todos os agentes.
- ✅ Desfazer a junção de conversas pela interface (06/10/2026): Histórico → Arquivadas → menu "…" → Desfazer junção (não junta de novo ao reiniciar; arquivos e artefatos movidos ficam na conversa de destino).
- ✅ Revisão do tema claro (06/10/2026): tons quentes/creme trocados por cinzas neutros (terminal, aprovação, VNC, fundos de janela, cor do navegador e do app instalado).
- ✅ Ícones que faltam no Marketplace (06/10/2026): WhatsApp com ícone próprio; Atlassian, Zapier, Granola, Stripe, Supabase e Sentry com selo na cor da marca (trocar pelos logos oficiais quando possível).
- ✅ Celular: barra de botões da caixa de mensagem apertada (06/10/2026): em 375px o botão de enviar não é mais espremido, o esforço sai da pílula do modelo (continua no seletor) e o nome do modelo encolhe primeiro.
- ✅ Ordem dos fixados e da lista salva nas configurações: igual em todos os aparelhos.
- [ ] Zero tela parada: progresso visível em rotinas de segundo plano e canais.
- ✅ Ações em lote e atalhos na Caixa (06/10/2026): marcar várias aprovações (ou todas) e aprovar/recusar de uma vez; teclado J/K navega, X marca, A aprova, R recusa (a seleção ou o item em foco). Perguntas abertas ("precisa de você") ficam fora do lote porque pedem texto. "Negar" virou "Recusar".
- [ ] Modo Simples × Enterprise revisado (nada importante escondido).
- [ ] Linguagem revisada em todas as telas (sem termos técnicos no modo Simples).
- [ ] Acessibilidade: navegação por teclado completa, leitores de tela, contraste.

### H. Observabilidade e suporte (P1)
- ✅ Logs estruturados, métricas, erros em linguagem humana, avisos do sistema na Caixa.
- ✅ Painel de saúde: servidor, Docker, contas do Claude, WhatsApp, e-mail, fila, backup — tudo numa tela (menu da conta › Saúde do Ripper, `GET /api/health/detalhado`).
- ✅ Relatório de erro com 1 clique (sem dados pessoais) para suporte (`GET /api/health/relatorio`; erros só em memória desde o último início).
- [ ] Auditoria de capacidades toda noite, com alerta na Caixa se algo quebrar.

### I. Acesso de qualquer lugar (P1 → Fase 2)
- ✅ PWA, notificações no aparelho, layout de tablet.
- [ ] **Pareamento por QR Code (modelo do Orca ADE).** O QR leva um link com: endereço do Ripper, um token do aparelho e a chave pública do computador. O celular conecta e toda a conversa vai **cifrada de ponta a ponta** (X25519 + NaCl), então quem repassa os dados não consegue ler. Aparelhos pareados ficam listados, com "Desconectar este aparelho"; gerar um QR novo invalida o anterior; o convite expira em até 10 minutos.
- ✅ **Em casa (mesma rede):** conexão direta pelo Wi-Fi, sem servidor nenhum. Configurações → "Celular na mesma rede": liga o acesso pela rede (padrão continua só 127.0.0.1; ligado, abre um segundo ouvinte só no IP do Wi-Fi, e exige senha criada), mostra o QR (link `http://<ip>:<porta>/pair?t=<token>`, uso único, 10 min, gerar outro invalida o anterior). Abrir o link cria uma sessão do aparelho (cookie `ripper_device`, separada da senha, guardada só com hash em `db.pairedDevices`, sobrevive a reinício); lista de aparelhos com "Desconectar este aparelho". `lib/pairing.mjs`, `test/pairing.test.mjs`.
  - Ainda falta nesta entrega: a chave pública no QR e a cifra de ponta a ponta (fica para a fase do relay). Hoje, na rede local, o tráfego vai em http puro: quem está no mesmo Wi-Fi pode ler. Trocar a senha não desconecta aparelhos (desconecte pela lista).
- [ ] **Fora de casa:** um **servidor de retransmissão** (relay) que liga celular e computador — o computador abre uma conexão de saída até ele, então não precisa abrir portas no roteador. É o que o Orca faz (relay próprio em `relay.onorca.dev`). Para o Ripper: **nós hospedamos um relay** (custo baixo: só repassa bytes cifrados) ou o usuário usa Tailscale como alternativa. *Decisão pendente: hospedar o relay.*
- [ ] Referência no código do Orca: `src/shared/pairing.ts`, `src/shared/mobile-relay-pairing-offer.ts`, `src/main/runtime/relay/`, `src/shared/e2ee-crypto.ts`, `src/main/ipc/mobile.ts`.
- [ ] Testar notificações de verdade (Android, iPhone instalado na tela inicial).
- ✅ Aprovar e recusar direto pela notificação (botões na notificação; perguntas abertas e configurações continuam abrindo o app). [ ] Testar num celular de verdade.

### J. Documentação (P1)
- 🔨 Guia de instalação e primeiro uso, em português: passo a passo em [instalacao.md](instalacao.md). [ ] Imagens.
- [ ] Central de ajuda dentro do app (o que cada coisa faz, exemplos de pedidos).
- ✅ Documentação para quem desenvolve (arquitetura, como rodar os testes, como criar uma integração): [desenvolvimento.md](desenvolvimento.md).

### K. Distribuição e negócio (P2)
- [ ] Versão em inglês revisada.
- [ ] Modelo de cobrança (se houver) e licença.
- [ ] Marketplace de agentes e skills prontos com instalação de 1 clique.

---

## 3.1 Como fazer o design (regras para qualquer tela nova ou mudada)

**Referência aprovada (06/10/2026):** o Grok Bot — mensageiro escuro, simples, rápido e eficiente. Pegar o jeito, não copiar tudo.
Três direções inventadas foram recusadas antes (cua.ai com neon, painel claro estilo Cloudflare, "rack de servidores"); só acertou com prints concretos. **Antes de inventar um visual novo, pedir print de referência ao dono.**

**Estrutura**
- Uma tela só: agentes à esquerda (fixados no topo + lista), conversa no centro, ficha do agente à direita.
- Um agente = uma conversa. Grupos são entradas próprias.
- O resto abre como **janela por cima** (Marketplace, Configurações), fecha com Esc ou clique fora e volta para onde estava. Nada de página nova para tarefa rápida.
- Cada tela tem uma ação principal; detalhes técnicos (tokens, custo, IDs, logs) só quando a pessoa abre o item.
- Configuração vai para a conversa quando possível (o agente manda o interruptor no balão).

**Visual** (variáveis em `web/src/styles.css`, `:root`)
- Escuro é o padrão: fundo `#070707`, lateral `#111`, balões e campos `#2c2c2c`/`#303030`, linhas brancas a 8–14%. Claro como opção, neutro (sem creme).
- Fonte Geist; cantos 14–22px; pílulas para botões pequenos; sombra só no que flutua (janelas, card sendo arrastado).
- Mascotes dos agentes (bot-avatars) em todo lugar onde o agente aparece: lista, fixados, ficha, menções.
- Cor só para estado: verde trabalhando/ok, âmbar esperando você, vermelho erro.

**Interação**
- Coisas que se organizam são **arrastáveis "na mão"**: o card sai inclinado seguindo o cursor, os outros deslizam abrindo espaço (animação de grade), soltar no lugar certo confirma, soltar fora cancela.
- Soltar um agente na conversa marca ele (botão com o mascote), sem escrever texto duplicado.
- Nada de texto cortado ou quebrado em botão, nada de rolagem lateral no celular, nada que suma ou encolha quando o conteúdo cresce.

**Antes de entregar**
- Testar a interação de verdade (arrastar, abrir/fechar janelas), não só olhar print.
- Conferir no celular (375px) e no desktop (1280 e 1440), nos dois temas.
- Detalhes de produto e público: `PRODUCT.md` na raiz.

## 4. Plano em fases

Ordem decidida pelo dono (06/10/2026): **confiabilidade → instalação fácil → celular fora de casa**. Imagem/vídeo e Omie vêm depois.

**Fase 0 — Confiabilidade (agora, outubro de 2026)**
Staging, servidor como serviço do sistema, retomar turnos após reinício, login com senha única, smoke diário, CI, teste de restauração do backup.
*Pronto quando:* o Ripper roda uma semana inteira na sua máquina sem reiniciar à mão nem perder resposta.

**Fase 1 — Instalação fácil (lançamento privado: você + 3 a 5 pessoas)**
Instalador Windows/Mac sem terminal, assistente de primeiro uso, funcionar sem Docker (modo reduzido), imagem dos agentes baixada pronta, atualização automática, termos e privacidade, guia de instalação.
*Pronto quando:* uma pessoa não técnica instala e usa sem a sua ajuda, em menos de 5 minutos.

**Fase 2 — Celular fora de casa (lançamento público)**
Acesso remoto seguro (login + HTTPS), notificações reais no Android/iPhone, aprovar pela notificação, telas revisadas no celular, painel de saúde, revisão de segurança.
*Pronto quando:* você conversa, acompanha e aprova pelo celular, fora de casa, com segurança.

**Fase 3 — Superar o Grok**
1ª palavra < 1 s, 50 tarefas reais com ≥ 80% concluídas sozinhas, Omie com sessões que se recuperam sozinhas, mais canais (Telegram, Instagram, Slack).
*Pronto quando:* os critérios do norte estão cumpridos e medidos.
- **Cursores dos agentes:** ver o cursor de cada agente ao vivo na aba Computador; vários agentes no mesmo computador ao mesmo tempo, cada um numa janela (referência: trycua/cua, avaliar licença).
- ✅ **Configuração dentro da conversa:** o agente oferece no balão o interruptor da configuração (ferramenta `offer_setting`, catálogo em `lib/setting-cards.mjs`); nada muda até o clique; sensíveis pedem confirmação. [ ] Ampliar o catálogo (escolhas com mais de duas opções, como modelo padrão).

**Fase 4 — Mídia**
Geração de imagem dentro das tarefas, depois vídeo.

## 5. Pendências de produto (não bloqueiam o lançamento)
- Geração de imagem e vídeo (Fase 4; escolher provedor: OpenAI/Gemini pela API ou modelo local).
- Cursor como provedor; Ripper Auto escolhendo modelos do OpenRouter (com uso pago ativo); tabela de preços atualizada.
- Prévia de .xlsx; busca dentro de PDF/Word na Biblioteca.
- Gatilho "planilha mudou"; passo de ação direta nos fluxos; resposta automática por remetente no e-mail.
- Guardião do GitHub aprovar/mesclar PR com aprovação do dono.
- Omie (Fase 3): agentes operando o Omie com sessões de portal que se recuperam sozinhas (detectar expiração, pausar o lote, pedir reautenticação na Caixa, retomar).
- Linha do tempo com print da tela por ação; delegação visível também para mensagens diretas.
- Catálogo único de Conectores / Integrações / Marketplace.
- B2B com um Ripper por pessoa: exportar/importar um time de agentes (instruções, rotinas, skills) para outro colega usar no Ripper dele.

---

## 6. Pontes conhecidas (defeitos que ainda não doem, mas vão doer)
- **Agentes e pasta compartilhada:** os agentes trabalham em `/project`, que é a mesma pasta onde o servidor roda; trocar de branch lá muda o código do Ripper em uso. Usar cópia própria para trabalhar no código.
- **Testes instáveis** em máquina carregada (servidor demora a subir).
- **`listExternal`** filtra em memória (até 5.000 linhas).
- **Trocar sozinho no limite** (contas do Claude) está desligado nas configurações atuais — com ele assim, o Ripper não passa para a outra conta quando uma esgota.
