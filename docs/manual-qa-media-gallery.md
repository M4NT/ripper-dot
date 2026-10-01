# QA manual — galeria de mídia / anexos

Sem harness E2E no `web/`; validar no navegador após `npm run dev:web` + `npm run dev:server`.

## Chat — imagens

1. Abra uma conversa e envie uma ou mais imagens (PNG/JPEG) com ou sem texto.
2. Clique na miniatura: deve abrir o lightbox com a imagem em tamanho maior (limitado à viewport).
3. Pressione **Esc** ou clique no fundo escuro: o lightbox fecha.
4. No lightbox, **Baixar** deve baixar o arquivo com o nome original.
5. Verifique que `alt` da imagem corresponde ao nome do arquivo (inspecionar elemento).

## Chat — arquivos não-imagem

1. Envie um `.pdf` ou `.txt`.
2. Deve aparecer um chip com ícone de arquivo, nome e ícone de download.
3. Clique no chip: download na mesma origem (sem abrir aba vazia desnecessária).

## Painel lateral — Arquivos

1. Com o painel aberto (tela larga), aba **Arquivos**.
2. Imagens da conversa aparecem na **Galeria** em grade.
3. Clique na miniatura ou no nome: lightbox.
4. Botão de download na linha e **Remover** continuam funcionando.
5. **Adicionar arquivo** só habilitado após a conversa existir (primeira mensagem enviada).

## Acessibilidade rápida

- Tab até uma miniatura no chat e Enter: abre lightbox.
- Tab no lightbox circula entre Baixar e Fechar.
