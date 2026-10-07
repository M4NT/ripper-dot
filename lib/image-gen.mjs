// Imagem pela assinatura do ChatGPT: o Codex CLI gera com gpt-image-2 (sem chave de API, sem cobrança por imagem).
// Cada imagem leva alguns minutos (o Codex raciocina antes de desenhar); quem pede deve saber disso.
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, stat, copyFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, extname, basename } from 'node:path';

export const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const TIMEOUT_MS = 10 * 60_000;

// O gpt-image só desenha 1:1, 2:3 e 3:2; story (9:16) e post vertical (4:5) saem em 2:3 com o essencial longe das bordas.
export const FORMATS = {
  post: { size: '1024x1024', label: 'post quadrado do feed (1:1)' },
  vertical: { size: '1024x1536', label: 'post vertical do feed (4:5): deixe uma margem livre no topo e na base, que o feed corta' },
  story: { size: '1024x1536', label: 'story/reels (9:16): texto e logo no centro, longe do topo e da base, que ficam sob a interface do app' },
  banner: { size: '1536x1024', label: 'banner ou capa horizontal (3:2)' },
  carrossel: { size: '1024x1024', label: 'carrossel do feed (1:1 por slide)' }
};

/** Argumentos do `codex exec` (testável sem CLI): geração ligada, referências como imagens anexadas. */
export function imageGenArgs(refs = []) {
  return ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-c', 'features.image_generation=true',
    ...refs.flatMap(r => ['-i', r]), '-'];
}

/** O pedido que o Codex recebe. Carrossel: N slides na mesma sessão, para manter o mesmo estilo. */
export function imageGenPrompt(prompt, hasRefs, { format = 'post', slides = 1 } = {}) {
  const f = FORMATS[format] || FORMATS.post;
  const n = format === 'carrossel' ? Math.max(2, Math.min(10, slides | 0 || 5)) : 1;
  return [
    n > 1
      ? `Gere ${n} imagens com a sua ferramenta de geração de imagens ($imagegen), uma por slide de um carrossel, todas com a mesma identidade visual (cores, fontes, estilo). O slide 1 é a capa; o último fecha com uma chamada para ação.`
      : 'Gere UMA imagem com a sua ferramenta de geração de imagens ($imagegen).',
    `Formato: ${f.label}. Tamanho ${f.size}.`,
    `Pedido: ${prompt}`,
    hasRefs ? 'As imagens anexadas são o kit de marca: siga as cores, o logo e o estilo delas.' : '',
    n > 1
      ? `Salve os PNGs nesta pasta como slide-01.png, slide-02.png… até slide-${String(n).padStart(2, '0')}.png. Não escreva código nem explique; responda só "ok".`
      : 'Salve o PNG final nesta pasta com o nome imagem.png. Não escreva código nem explique; responda só "ok".'
  ].filter(Boolean).join('\n');
}

/** As imagens geradas, em ordem: as da pasta de trabalho ou, se o Codex só guardou na pasta dele, as criadas depois de `since`. */
export async function pickGenerated(workDir, codexImagesDir, since, want = 1) {
  const files = async dir => (await readdir(dir, { recursive: true }).catch(() => [])).filter(f => IMAGE_EXT.test(f)).map(f => join(dir, f));
  const local = (await files(workDir)).sort((a, b) => basename(a).localeCompare(basename(b), 'pt', { numeric: true }));
  if (local.length) return local.slice(0, want);
  const fresh = [];
  for (const f of await files(codexImagesDir)) {
    const t = (await stat(f).catch(() => null))?.mtimeMs || 0;
    if (t >= since) fresh.push([t, f]);
  }
  return fresh.sort((a, b) => a[0] - b[0]).map(x => x[1]).slice(-want);
}

/**
 * Gera e copia para `outDir` como `<base>.png` (ou `<base>-01.png`… no carrossel). Devolve os caminhos.
 * `run` troca o processo nos testes.
 */
export async function generateImages({ prompt, refs = [], format = 'post', slides, outDir, base, signal, run = runCodex, codexHome = process.env.CODEX_HOME || join(homedir(), '.codex') }) {
  const work = await mkdtemp(join(tmpdir(), 'ripper-img-'));
  const since = Date.now() - 1000;
  const want = format === 'carrossel' ? Math.max(2, Math.min(10, slides | 0 || 5)) : 1;
  try {
    const { code, err } = await run(imageGenArgs(refs), imageGenPrompt(prompt, refs.length > 0, { format, slides: want }), work, signal);
    const imgs = await pickGenerated(work, join(codexHome, 'generated_images'), since, want);
    if (!imgs.length) throw new Error(code ? `o Codex falhou: ${err.slice(-300).trim() || 'rode `codex login` com a conta do ChatGPT'}` : 'o Codex terminou sem gerar imagem (a sua conta do ChatGPT tem geração de imagens?)');
    await mkdir(outDir, { recursive: true });
    const out = [];
    for (const [i, img] of imgs.entries()) {
      const dest = join(outDir, `${base}${want > 1 ? `-${String(i + 1).padStart(2, '0')}` : ''}${extname(img) || '.png'}`);
      await copyFile(img, dest);
      out.push(dest);
    }
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
    const timer = setTimeout(kill, TIMEOUT_MS * 2);
    signal?.addEventListener('abort', kill, { once: true });
    child.stderr?.on('data', d => { err += d; });
    child.on('error', e => { err += e.message; });
    child.on('close', code => { clearTimeout(timer); resolve({ code, err }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
