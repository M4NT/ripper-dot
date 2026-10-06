// Esqueci a senha: define uma senha nova pelo terminal (derruba todas as sessões abertas).
// Uso: node scripts/senha.mjs            (pergunta a senha nova)
//      node scripts/senha.mjs --apagar   (o Ripper volta a pedir uma senha nova ao abrir neste computador)
import { createInterface } from 'node:readline/promises';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataUrl } from '../lib/store.mjs';
import { hashPassword, passwordProblem, passwordFile } from '../lib/auth.mjs';

const path = fileURLToPath(dataUrl('./data/auth.json'));
if (process.argv.includes('--apagar')) {
  rmSync(path, { force: true });
  console.log('Senha apagada. Abra o Ripper neste computador para criar uma nova.');
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question('Nova senha do Ripper: ');
  rl.close();
  const err = passwordProblem(pw);
  if (err) { console.error(err); process.exit(1); }
  passwordFile(path).set(await hashPassword(pw));
  console.log('Senha trocada. Entre de novo no Ripper com a senha nova.');
}
