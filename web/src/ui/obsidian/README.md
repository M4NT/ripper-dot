# ObsidianUI no Ripper

Fonte: [obsidianui.dev](https://www.obsidianui.dev/) (MIT). Instruções para agentes: [llms.txt](https://www.obsidianui.dev/llms.txt).
Registro lido em 10/10/2026. Os componentes de lá são copiados para o projeto (shadcn registry), não vêm como pacote npm.

## O que entrou

Só o que mapeia aos primitivos da UI-2. Reescritos em CSS do Ripper (`tokens.css` + `ui-state.css`), **sem Tailwind**.

| ObsidianUI | Nosso primitivo | O que veio |
|---|---|---|
| `skeleton` | `Skeleton` | `data-slot="skeleton"`, pulso, bloco componível |
| `empty` | `EmptyState` | slots `empty` / `empty-icon` / `empty-title` / `empty-description` |
| `alert` | `ErrorState` | `role="alert"`, slots de título/descrição, variante destrutiva |
| `card` | `Card` + `CardHeader` / `Title` / `Description` / `Content` / `Footer` | casca, slots, composição |
| `sheet` + `drawer` | `BottomSheet` | overlay, handle, header/body, `data-slot` |

`VirtualList` não tem equivalente na ObsidianUI — ficou a implementação própria (sem lib).

## O que não entrou (de propósito)

- **Tailwind CSS.** O Ripper não usa Tailwind. Trazer o pipeline (PostCSS, `cn` + `tailwind-merge`, `cva`) só para estes primitivos duplicaria os tokens de `styles.css` e incharia o CSS da tela principal. Os `className` da registry foram traduzidos para classes nossas.
- **Motion / GSAP.** A spec pede mensageiro rápido. Motion entra em quase todo bloco “de vitrine” da ObsidianUI. Aqui a animação é CSS curta (`--out`) e respeita `prefers-reduced-motion`.
- **Radix Dialog e Vaul.** `sheet` depende de `@radix-ui/react-dialog`; `drawer` de `vaul`. São dependências novas para um comportamento que já cobrimos (Esc, foco preso, arrastar, `100dvh`).
- **WebGL / canvas / efeitos de vitrine:** `v-prism`, `liquid-metal`, `loaders-gooey-blobs`, `art-gallery`, `flip-text`, `text-stream`, `click-spark`, dashboards. Pesados e fora do Grok Bot.
- **lucide-react, clsx.** O Ripper já tem `Icon` em `ui.jsx`.

Licença MIT da ObsidianUI: `LICENSE` nesta pasta. Os arquivos adaptados citam a origem no cabeçalho.
