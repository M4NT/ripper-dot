// CSS da interface inteira: o styles.css principal e os arquivos de web/src/styles/telas/,
// que cada tela carrega junto com o próprio código. Os scripts de guarda leem os dois.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../web/src/', import.meta.url));

function cssEmPasta(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(nome => {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) return cssEmPasta(p);
    return p.endsWith('.css') ? [p] : [];
  }).sort();
}

export function lerCssDaInterface() {
  const principal = readFileSync(join(SRC, 'styles.css'), 'utf8');
  const telas = cssEmPasta(join(SRC, 'styles', 'telas')).map(f => readFileSync(f, 'utf8'));
  return [principal, ...telas].join('\n');
}
