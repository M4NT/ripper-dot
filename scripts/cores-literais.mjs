// Guarda de cores: conta as cores escritas direto no CSS (fora dos blocos de tema :root).
// A meta é só diminuir. scripts/cores-literais.base.json guarda o número aceito; se o CSS ganhar mais cores literais, o script falha.
// Para aceitar uma redução de propósito, rode com --atualizar (reescreve a base com o número atual).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lerCssDaInterface } from '../lib/css-interface.mjs';

const BASE = fileURLToPath(new URL('./cores-literais.base.json', import.meta.url));

const css = lerCssDaInterface();
// Tira os blocos de tema (definições de variáveis) e os comentários; o que sobra são cores literais de uso.
const semTemas = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root(:not\([^)]*\))?\s*\{[\s\S]*?\n\}/g, '');
const literais = [...semTemas.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0].toLowerCase());
const atual = literais.length;
const unicas = [...new Set(literais)].sort();

if (process.argv.includes('--atualizar')) {
  writeFileSync(BASE, JSON.stringify({ literais: atual }, null, 2) + '\n');
  console.log(`base atualizada: ${atual} cores literais.`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASE, 'utf8')).literais;
console.log(`cores literais fora dos temas: ${atual} (${unicas.length} diferentes). Base aceita: ${base}.`);
if (atual > base) {
  console.log(`FALHA: subiu ${atual - base}. Use uma variável de tema (--ink, --surface, --line...) em vez de cor literal.`);
  process.exit(1);
}
console.log(atual < base ? `Caiu ${base - atual}: rode com --atualizar para travar o novo número.` : 'Igual à base.');
