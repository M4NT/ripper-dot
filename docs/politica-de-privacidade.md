# Política de privacidade do Ripper

> **RASCUNHO — pendente de revisão jurídica.** Este texto descreve, em linguagem simples, o que o programa faz hoje. Ainda **não** foi revisado por advogado e **não** é uma declaração de conformidade com a LGPD. Os detalhes técnicos estão em [privacidade-e-dados.md](privacidade-e-dados.md).

Última atualização do rascunho: 06/10/2026.

## Resumo

1. O Ripper roda no **seu** computador e guarda tudo lá.
2. Quem faz o Ripper **não recebe** suas conversas, arquivos nem estatísticas de uso. O programa não tem rastreamento.
3. Quando um agente responde, o texto da conversa **vai para a empresa de IA** que você escolheu (Anthropic, OpenAI ou outra que você configurar).
4. As integrações que você ligar (WhatsApp, e-mail, GitHub, Google Tarefas, conectores) trocam dados com esses serviços.

## O que fica no seu computador

Tudo fica numa pasta de dados (por padrão a pasta `data`, dentro da pasta do Ripper):

- agentes, conversas, mensagens, memórias e rotinas;
- arquivos enviados por você e criados pelos agentes;
- configurações, inclusive chaves e senhas de conectores (guardadas **cifradas**);
- contadores de uso e o registro das ações externas (o que foi enviado, para quem e quando — **sem** o conteúdo);
- backups automáticos.

O login da sua conta do Claude fica na pasta do próprio Claude Code (e, para contas extras, na pasta `.ripper/claude-accounts` do seu usuário). Ele **não entra** nos backups do Ripper.

## O que sai do seu computador

| Para onde | O que vai | Quando |
| --- | --- | --- |
| Anthropic (Claude) | Texto da conversa, instruções do agente, memórias e arquivos que o agente usa na resposta | Quando um agente Claude responde |
| OpenAI (ChatGPT / Codex) | O mesmo | Quando um agente usa Codex/ChatGPT |
| Outros provedores que você configurar (ex.: OpenRouter) | O mesmo | Quando usados |
| Meta (WhatsApp oficial) ou a ferramenta do modo QR Code | Mensagens recebidas e respostas | Se o WhatsApp estiver ligado |
| Seu provedor de e-mail | Leitura e envio de e-mails | Se o e-mail estiver ligado |
| GitHub, Google Tarefas, conectores, webhooks | O que a tarefa precisar | Se você ligar |
| Sites que o agente abre | Navegação comum | Quando o agente usa o navegador |

Cada empresa trata os dados segundo **a política dela**. Leia as políticas da Anthropic e da OpenAI, principalmente se for usar dados de clientes. Contas de empresa (Teams, Enterprise, API) costumam ter regras diferentes das contas pessoais sobre o uso dos dados.

## Como reduzir o que é enviado

- **Esconder dados pessoais**: em Configurações → Segurança → LGPD, o Ripper troca CPF, documentos, dados financeiros e contatos por `[PII]` **antes** de enviar o texto à IA. O histórico no seu computador continua completo.
- Não cole senhas, dados de cartão ou documentos sensíveis nas conversas.
- Ligue só as integrações que você vai usar.

## Dados de clientes no WhatsApp

Se você usa o Ripper para atender clientes, **você é o responsável** pelos dados deles perante a LGPD (o Ripper é a ferramenta que você roda). Na prática:

- tenha o **consentimento** do cliente para ser atendido por um assistente automatizado e avise que é IA;
- as mensagens dele serão enviadas à empresa de IA para gerar a resposta;
- se ele pedir para apagar os dados, apague a conversa no Ripper (ou use a eliminação em Segurança → LGPD) e, se for o caso, no próprio WhatsApp.

Em Configurações → Plugins → Canal WhatsApp você registra o consentimento de cada cliente (número, data e como foi obtido). Ligando **Exigir consentimento**, quem não tem registro não recebe resposta automática: o agente só faz um rascunho para você aprovar. Desligado (padrão), vale só a lista de números permitidos.

## Levar seus dados

Em Configurações → Segurança → LGPD, **Exportar tudo** baixa um pacote (.tar.gz) com as conversas em Markdown, agentes e rotinas em JSON, arquivos e artefatos. Senhas, chaves e tokens não entram.

## Por quanto tempo os dados ficam

- Conversas ficam até você apagar, ou até o prazo que você definir em Configurações → Segurança (apagamento automático por idade).
- Contadores de uso guardam só os eventos mais recentes.
- O registro de ações externas não pode ser apagado (é a trilha de auditoria); por isso ele **não guarda o conteúdo** das mensagens.

## Apagar tudo

- Pelo app: Configurações → Segurança → LGPD → eliminação de dados (apaga conversas, memórias, anexos e aprovações; mantém agentes e chaves).
- Por completo: feche o Ripper e apague a pasta de dados. Faça um backup antes, se quiser guardar algo.

## Contato

*[Responsável e canal para dúvidas sobre privacidade: a definir na revisão jurídica.]*
