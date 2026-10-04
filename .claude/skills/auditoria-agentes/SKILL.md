---
name: auditoria-agentes
description: Audita se os agentes do Ripper estão funcionais em todas as áreas (conversa, web sem VM, pesquisa, arquivos, Excel, memória, documentos, rotinas, delegação, scripts, navegador, conectores, multitarefa), medindo ferramentas escolhidas, tempo e tokens. Use quando pedirem para verificar/testar/auditar os agentes, antes e depois de mudanças em agentes, modelos, ferramentas ou economia de tokens, ou para atualizar o catálogo de capacidades (docs/capacidades.md).
---

# Auditoria de capacidades dos agentes

Mede o Ripper como um usuário usaria: tarefas reais, uma por área, contra o servidor rodando.
O resultado é o catálogo vivo do que os agentes sabem fazer — e a régua para toda melhoria.

## Rodar

Pré-requisito: Ripper no ar (`node server.mjs`, porta 3000). Para "navegador" e "excel", o
computador dos agentes em modo Docker; para "agenda", Google Agenda conectado na conta claude.ai.

```bash
node scripts/agent-audit.mjs                    # todas as áreas (~10 min, modelo barato)
node scripts/agent-audit.mjs web memoria        # só algumas (atualiza só essas no catálogo)
node scripts/agent-audit.mjs relatorio          # só regenera o .md a partir do .json
MODEL=claude-sonnet-5-5 node scripts/agent-audit.mjs   # comparar com outro modelo
```

Ids: conversa, web, pesquisa, arquivo, excel, memoria, artefato, rotina, delegacao, scripts,
navegador, agenda, multitarefa.

Gera `docs/capacidades.md` (tabela legível) e `docs/capacidades.json` (para comparar execuções).

## Garantias

- Cria dois agentes temporários ("Auditor Ripper" e "Auditor Colega") e **apaga tudo no fim**:
  agentes, conversas, artefatos, rotinas e scripts criados pela auditoria.
- Usa o modelo mais barato (`claude-haiku-4-5`, esforço baixo): mede o piso da plataforma.
- **Nunca envia nada para fora**: não testa envio de WhatsApp, e-mail nem publicação. A área
  "agenda" só lê.
- Aprovações pedidas pelos agentes da auditoria são aprovadas automaticamente e contadas.

## Ler o resultado

- **falhou** → a capacidade está quebrada ou o agente não soube usar a ferramenta. Leia a
  resposta nos detalhes antes de concluir: às vezes é a instrução, não a ferramenta.
- **caminho caro** → funcionou, mas gastando mais do que precisava (ex.: abriu o navegador da VM
  para só ler uma página). É bug de economia: corrija a orientação do agente ou a ferramenta.
- **Tempo** alto até em "Conversa" indica custo fixo da plataforma (partida do SDK, prompt de
  sistema grande), não do modelo.
- Compare `docs/capacidades.json` antes/depois de cada mudança; não declare melhoria sem medir.

## Adicionar uma área

Em `scripts/agent-audit.mjs`, acrescente em `AREAS`: `id`, `area`, `run` (o pedido) e `ok`
(como saber que funcionou, olhando `r.text` e `r.tools`). Se houver um caminho mais barato
esperado, informe `best` e `economy`. Limpe no `finally` o que a área criar.
