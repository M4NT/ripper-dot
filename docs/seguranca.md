# Revisão de segurança antes do lançamento

Data: 06/10/2026. Escopo: item "Revisão de segurança completa" da seção A do [ROADMAP](ROADMAP.md).

## 1. O que foi verificado

### Rotas sem login
O portão fica em `server.mjs`: toda rota `/api/*` passa por `signedIn(req)` (sessão da senha, celular pareado ou `RIPPER_TOKEN`), exceto `/api/auth/*` e `GET /api/health`. Antes do portão ficam:

| Rota | Proteção | Situação |
|---|---|---|
| `GET /healthz`, `/readyz`, `/api/health` | nenhuma; devolvem só `ok`, versão e uptime | ok |
| `/openapi.json`, `/docs` | nenhuma; documentação estática | ok |
| `POST /api/channels/whatsapp-web/<token>` (Evolution) | token aleatório de 48 hex na URL **e** no cabeçalho, comparação em tempo constante | ok |
| `/api/channels/whatsapp/webhook` (Meta) | GET: verify token; POST: assinatura HMAC `x-hub-signature-256` | ok (verify token não é comparado em tempo constante; risco baixo) |
| `POST /api/hooks/<token>` (rotinas) | token de 48 hex; assinatura HMAC se a rotina tiver segredo | ok |
| `GET /api/mcp/oauth/callback`, `/api/task-sync/google/oauth/callback` | `state` do fluxo (aleatório, expira) | **corrigido** (ver 2.2) |
| `GET /pair?t=` | convite de uso único e curto, gerado só no computador local | ok |
| `/metrics` | usava a regra antiga | **corrigido** (ver 2.1) |
| `?token=<RIPPER_TOKEN>` | troca o token por cookie HttpOnly/Strict | ok |
| arquivos estáticos | `new URL` normaliza `..` e o caminho é conferido contra `DIST` | ok |

Rotas que mexem na máquina (escolher pasta, listar pastas, parear, login de CLI, criar a primeira senha) exigem também `isLocalRequest`: loopback **e** não vindo de contêiner de agente.

### Uploads
`POST /api/files`: tamanho limitado (`MAX_FILE`); nome passa por `basename` + lista de caracteres permitidos e ganha prefixo do id; a pasta vem de ids conferidos (`agentOr404`/`projectOr404`). Download (`GET /api/files/:id`) lê só o caminho gravado no banco, nunca um vindo do navegador; HTML/SVG não são servidos inline; PDF inline com CSP `sandbox`. Logo da marca: regex `[\w.-]+` + `isSafeBrandStoragePath` + detecção do tipo da imagem. Sem problemas.

### Caminhos de arquivo
Pasta de trabalho (`lib/workspace.mjs`): precisa ser absoluta, existir, não ser raiz do disco, pasta do sistema nem a pasta de dados do Ripper; só pode ser escolhida no próprio computador. Arquivos servidos (`/api/files`, tela do agente, logo) usam caminhos do servidor. Sem problemas.

### Execução de comandos
- Docker (padrão): o agente roda no contêiner dele; `computer_exec` passa por `execNeedsApproval` (padrões arriscados em `lib/approvals.mjs` + Julia como segunda opinião no modo `risky`).
- Modo local: só com `computer.allowLocalCommands`, e **todo** comando pede aprovação, em qualquer nível de autonomia.
- Comandos montados pelo servidor (clone/PR do GitHub): repositório passa por `normalizeRepo` (`[\w.-]`), branch por `prBranch` (`[\w.-]`); o token vai só no argumento `-c http.extraheader` e é escondido da saída. O nome do agente entra entre aspas duplas no `git config`; é texto do dono e roda dentro do contêiner, risco baixo.

### MCP de terceiros
Conectores só são criados/alterados por `/api/connectors` (atrás do login); agentes não instalam conectores. Segredos e tokens OAuth vão para o cofre cifrado e são redigidos nas respostas. Um MCP `stdio` roda como processo **desta máquina, com as permissões do usuário**: é confiança total no pacote escolhido pelo dono. A saída de qualquer MCP é texto de terceiros que entra no contexto do agente (risco de prompt injection), mitigado pelas aprovações nas ações externas.

## 2. O que foi corrigido

### 2.1 `/metrics` aberto sem `RIPPER_TOKEN`
Usava `authed(req, TOKEN)`, que libera tudo quando não há token — o caso normal desde o login por senha. Qualquer um na rede via as métricas.
**Decisão:** `/metrics` segue a mesma regra do resto do app (sessão, celular pareado ou `RIPPER_TOKEN`); scrape sem login só com `RIPPER_METRICS_PUBLIC=1`.
Arquivos: `lib/metrics.mjs` (`metricsAccessAllowed(signedIn)`), `server.mjs`, `lib/openapi.mjs`. Testes: `test/metrics.test.mjs`, `test/auth.test.mjs` (401 sem login, 200 com sessão).

### 2.2 XSS refletido nos callbacks OAuth
`error_description` da URL ia direto para o HTML de `/api/mcp/oauth/callback` e `/api/task-sync/google/oauth/callback`. Exigia um `state` válido, mas não pode existir. Agora passa por `escapeHtml` (`lib/mcp-oauth.mjs`). Teste: `test/mcp-oauth.test.mjs`.

## 3. O que fica pendente
- HTTPS/túnel para acesso fora de casa (item próprio do ROADMAP). Até lá, `/healthz`, `/docs` e os webhooks ficam expostos na rede onde o Ripper escuta.
- Verify token do webhook da Meta: comparar em tempo constante (baixo risco).
- MCP `stdio` sem isolamento: avaliar rodar dentro do contêiner do agente ou avisar na tela ao adicionar.
- Sessões e limite de login em memória (por decisão; reiniciar pede a senha de novo).
- Rotina por webhook sem segredo HMAC depende só do token da URL: sugerir segredo na tela.

## 4. Política de permissões por nível de autonomia (rascunho)

Fonte: `lib/autonomy.mjs`, `lib/permissions.mjs`, `lib/approvals.mjs`, `server.mjs`. No modo simples (não empresa), "totalmente autônomo" vira "semi-autônomo".

| Ação | Somente leitura | Semi-autônomo (padrão) | Totalmente autônomo (só modo empresa) |
|---|---|---|---|
| Conversar, pesquisar, ler arquivos/artefatos/skills, memória, abrir e ler página | livre | livre | livre |
| Comando no próprio computador (`computer_exec`) | **bloqueado** | pede se o comando for arriscado (lista + Julia) ou conforme a política global | não pede |
| Comando na máquina do usuário (modo local) | bloqueado | **sempre** pede | **sempre** pede |
| Clicar/digitar no navegador | **bloqueado** | pede em ação arriscada (envio, compra, login…) | não pede |
| Publicar porta na internet (`computer_share`) | bloqueado | pede | não pede |
| Salvar artefato/skill, agendar rotina | bloqueado | livre | livre |
| Mensagem para outro agente (`send_message`) | bloqueado | livre | livre |
| Postar em rede social / webhook externo | bloqueado | pede | não pede |
| Ferramenta de conector MCP (plugin do usuário ou conector claude.ai) | **bloqueada**, salvo se o servidor a marcou `readOnlyHint` | livre | livre |
| GitHub (comentar, issue, PR), e-mail, WhatsApp | conforme a ferramenta | pede (envio passa pelo X9 Guard) | pede |

Em todos os níveis: ação externa aprovada entra no registro imutável; "aprovar sempre nesta conversa" vale só para o mesmo comando, na mesma conversa (até 80); aprovação sem resposta expira como negada.

**Conectores MCP em somente leitura:** o Ripper guarda em `plugin.readOnlyTools` os nomes que o servidor marcou `annotations.readOnlyHint: true` na última listagem (verificar conector / listar ferramentas). Só esses passam: no Claude viram `allowedTools` explícitos e o `canUseTool` nega o resto; no Codex o servidor entra com `enabled_tools` (ou nem entra, se não houver nenhuma); nos provedores compatíveis com OpenAI o filtro olha a annotation ao vivo. Conector nunca listado e conectores do claude.ai (sem annotations visíveis) ficam bloqueados. A lista não vem do cliente e cai quando a URL/comando do conector muda.

## 5. Certificado digital A1 (NF-e recebidas, DF-e)

Código: `lib/dfe.mjs`, rotas `/api/certificados`, tela `web/src/marketplace/CertificadosPanel.jsx` (dentro do Omie ERP). Testes: `test/dfe.test.mjs`.

- **O que é guardado:** o arquivo `.pfx`/`.p12` (em base64) e a senha, cifrados no cofre (`connection-vault.json`, chave `cert.<CNPJ>`). O `db.json` guarda só metadados (titular, CNPJ, validade) e as notas recebidas.
- **Nunca em claro:** a senha não vai para log, para a resposta da API nem para a tela (o campo é `type=password` e é limpo depois de uma tentativa com erro). A resposta do cadastro traz só titular, CNPJ e validade.
- **Conferências ao enviar:** senha correta (a leitura do certificado é feita pela própria TLS do Node, sem parser PKCS#12 extra), CNPJ do certificado igual ao da empresa (ou a mesma raiz de 8 dígitos, filial), não vencido e já válido. Se falhar, nada é guardado.
- **Validade:** "vence em menos de 30 dias" e "vencido" viram aviso na Caixa (`cert:<CNPJ>`), que some quando o certificado é trocado ou removido.
- **Uso:** só leitura. O certificado entra como cliente TLS (mTLS) na Distribuição DF-e (`NFeDistribuicaoDFe`, Ambiente Nacional), em `hom1` (tpAmb 2) ou `www1` (tpAmb 1). Nenhuma escrita na Receita.
- **Regra de consumo da Receita:** cStat 656 para a consulta e guarda `nextAllowedAt` = agora + 1 h. Enquanto isso, nenhuma chamada sai. Cada sincronização faz no máximo 5 chamadas e para no maxNSU.
- **Ferramentas dos agentes:** `dfe_listar_notas_recebidas` (do banco) e `dfe_sincronizar` (consulta a Receita). Aparecem só se alguma empresa tiver certificado cadastrado. Nenhuma das duas escreve em sistema externo.
- **Teste sem rede:** o certificado de teste é gerado com `openssl` numa pasta temporária e nunca é commitado; a Receita é simulada por servidor HTTPS local (`RIPPER_DFE_URL`). Nenhum teste chama a Receita real.
- **Pendências:** conferir com o certificado real da empresa em homologação antes de usar em produção; o owner envia o `.pfx` pela tela, nunca por arquivo no repositório.
