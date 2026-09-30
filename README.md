# Ripper

Aplicação local para criar agentes de IA, conversar individualmente ou em grupo, organizar projetos e executar rotinas.

## Requisitos

- Node.js 22 ou superior
- `claude login` para usar a assinatura Claude, ou uma chave de API configurada na aplicação
- `codex login` para usar o Codex

## Executar

```sh
npm install
npm run build
npm start
```

Acesse `http://127.0.0.1:3000`. Para desenvolvimento, rode `npm run dev:server` e `npm run dev:web` em terminais separados. O classificador opcional inicia com `npm run julia`.

## Testes

```sh
npm test
```

Os dados locais ficam em `data/`, que não é enviado ao Git. Ao expor o servidor na rede, configure `RIPPER_TOKEN`. O modo de comandos locais exige ativação explícita em Integrações.
