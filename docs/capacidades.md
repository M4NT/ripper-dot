# Capacidades dos agentes — auditoria de 04/10/2026, 12:17:01

Modelo usado: `claude-haiku-4-5` (esforço baixo). **13/13 áreas funcionando.** Tokens são aproximados (resposta ÷ 4).

| Área | Resultado | Ferramentas usadas | Tempo | Tokens (resp.) | Economia |
|---|---|---|---|---|---|
| Conversa | funciona | — | 7.3s | 2 | — |
| Ler página (sem VM) | funciona | WebFetch | 10.4s | 5 | caminho barato |
| Pesquisa na web | funciona | WebSearch | 24.4s | 93 | — |
| Ler arquivo anexado | funciona | — | 9.5s | 2 | — |
| Gerar planilha Excel | funciona | computer_exec | 32.2s | 65 | — |
| Memória entre conversas | funciona | remember | 6.9s | 3 | — |
| Documento (artefato) | funciona | save_artifact | 11.7s | 33 | — |
| Rotina agendada | funciona | schedule_routine | 11.3s | 34 | — |
| Delegar para outro agente | funciona | send_message | 9.9s | 21 | — |
| Aprender e reaproveitar script | funciona | computer_exec, save_script | 17.1s | 28 | — |
| Navegador da VM (quando precisa interagir) | funciona | browser_open | 16.6s | 7 | — |
| Conector (Google Agenda, só leitura) | funciona | mcp__claude_ai_Google_Calendar__list_events | 13.5s | 29 | — |
| Multitarefa (web + computador) | funciona | WebFetch, computer_exec | 22.1s | 12 | — |

## Detalhes das falhas

