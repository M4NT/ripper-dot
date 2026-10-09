// Gera skills/visual-openui.md a partir da biblioteca OpenUI instalada. Rode de novo se a biblioteca mudar.
import { writeFileSync } from 'node:fs';
import { openuiInstructions } from '../lib/openui-prompt.mjs';

const corpo = `# Visual (OpenUI)

Use esta skill quando a resposta ficar mais clara como visual: gráfico, tabela, formulário, cartão, indicador, lista de passos ou aviso.

Como usar: escreva um bloco de código com a linguagem \`openui\` dentro da resposta. O chat desenha os componentes. Se a resposta for simples, continue só com texto.

${openuiInstructions()}
`;
writeFileSync(new URL('../skills/visual-openui.md', import.meta.url), corpo);
console.log('skills/visual-openui.md gerado,', corpo.length, 'caracteres');
