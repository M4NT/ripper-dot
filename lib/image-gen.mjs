// Imagem pela assinatura do ChatGPT: o Codex CLI gera com gpt-image-2 (sem chave de API, sem cobrança por imagem).
// Cada imagem leva alguns minutos (o Codex raciocina antes de desenhar); quem pede deve saber disso.
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, stat, copyFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, extname } from 'node:path';

export const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const TIMEOUT_MS = 10 * 60_000;

/** Argumentos do `codex exec` (testável sem CLI): geração ligada, referências como imagens anexadas. */
export function imageGenArgs(refs = []) {
  return ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-c', 'features.image_generation=true',
    ...refs.flatMap(r => ['-i', r]), '-'];
}

/** O pedido que o Codex recebe: uma imagem só, salva como imagem.png na pasta de trabalho. */
export function imageGenPrompt(prompt, hasRefs) {
  return [
    'Gere UMA imagem com a sua ferramenta de geração de imagens ($imagegen).',
    `Pedido: ${prompt}`,
    hasRefs ? 'As imagens anexadas são o kit de marca: siga as cores, o logo e o estilo delas.' : '',
    'Salve o PNG final nesta pasta com o nome imagem.png. Não escreva código nem explique; responda só "ok".'
  ].filter(Boolean).join('\n');
}

/** A imagem gerada: imagem.png na pasta de trabalho ou, se o Codex só guardou na pasta dele, a mais nova criada depois de `since`. */
export async function pickGenerated(workDir, codexImagesDir, since) {
  const files = async dir => (await readdir(dir, { recursive: true }).catch(() => [])).filter(f => IMAGE_EXT.test(f)).map(f => join(dir, f));
  const local = await files(workDir);
  if (local.length) return local.find(f => /imagem\.png$/i.test(f)) || local[0];
  let best = null, bestT = since;
  for (const f of await files(codexImagesDir)) {
    const t = (await stat(f).catch(() => null))?.mtimeMs || 0;
    if (t >= bestT) { best = f; bestT = t; }
  }
  return best;
}

/** Gera a imagem e copia para `outFile`. `run` troca o processo nos testes. */
export async function generateImage({ prompt, refs = [], outFile, signal, run = runCodex, codexHome = process.env.CODEX_HOME || join(homedir(), '.codex') }) {
  const work = await mkdtemp(join(tmpdir(), 'ripper-img-'));
  const since = Date.now() - 1000;
  try {
    const { code, err } = await run(imageGenArgs(refs), imageGenPrompt(prompt, refs.length > 0), work, signal);
    const img = await pickGenerated(work, join(codexHome, 'generated_images'), since);
    if (!img) throw new Error(code ? `o Codex falhou: ${err.slice(-300).trim() || 'rode `codex login` com a conta do ChatGPT'}` : 'o Codex terminou sem gerar imagem (a sua conta do ChatGPT tem geração de imagens?)');
    const out = extname(outFile) ? outFile : outFile + extname(img);
    await mkdir(dirname(out), { recursive: true });
    await copyFile(img, out);
    return out;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function runCodex(args, input, cwd, signal) {
  return new Promise(resolve => {
    const child = spawn('codex', args, { cwd, shell: process.platform === 'win32' });
    let err = '';
    const kill = () => child.kill();
    const timer = setTimeout(kill, TIMEOUT_MS);
    signal?.addEventListener('abort', kill, { once: true });
    child.stderr?.on('data', d => { err += d; });
    child.on('error', e => { err += e.message; });
    child.on('close', code => { clearTimeout(timer); resolve({ code, err }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
