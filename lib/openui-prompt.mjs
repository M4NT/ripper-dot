// Instruções de OpenUI Lang para o modelo, a partir da biblioteca completa (lib/openui-library.mjs).
// Viram a skill skills/visual-openui.md (gerada por scripts/gerar-skill-visual.mjs); o prompt do sistema só aponta para ela.
import { openuiTudo } from './openui-library.mjs';

export const openuiInstructions = () => openuiTudo.prompt({
  preamble: 'Para mostrar dados em formato visual (gráficos, tabelas, formulários, cartões, indicadores), escreva um bloco de código com a linguagem openui. Use o bloco só quando ele for mais claro que texto; resposta simples continua em texto.',
  additionalRules: ['Feche sempre o bloco com ```.', 'Escreva os textos em português do Brasil.']
});
