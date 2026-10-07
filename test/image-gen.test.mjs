import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateImages, imageGenArgs, imageGenPrompt } from '../lib/image-gen.mjs';
import { buildRipperBuiltinTools } from '../lib/ripper-builtin-tools.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'img-test-'));

test('codex exec liga a geração de imagem e anexa o kit de marca', () => {
  const args = imageGenArgs(['/a/logo.png']);
  assert.deepEqual(args.slice(0, 2), ['exec', '--skip-git-repo-check']);
  assert.ok(args.join(' ').includes('features.image_generation=true'));
  assert.deepEqual(args.slice(-3), ['-i', '/a/logo.png', '-']);
  assert.match(imageGenPrompt('Bom dia com café', true), /kit de marca/);
  assert.doesNotMatch(imageGenPrompt('Bom dia', false), /kit de marca/);
});

test('cada formato pede o tamanho que o gpt-image desenha', () => {
  assert.match(imageGenPrompt('x', false), /1:1.*1024x1024/s);
  assert.match(imageGenPrompt('x', false, { format: 'story' }), /9:16.*1024x1536/s);
  assert.match(imageGenPrompt('x', false, { format: 'vertical' }), /4:5.*1024x1536/s);
  assert.match(imageGenPrompt('x', false, { format: 'banner' }), /1536x1024/);
  const c = imageGenPrompt('x', false, { format: 'carrossel', slides: 3 });
  assert.match(c, /Gere 3 imagens/);
  assert.match(c, /slide-03\.png/);
});

test('post: copia a imagem salva na pasta de trabalho', async () => {
  const dir = join(tmp(), 'arte');
  const run = async (args, input, cwd) => { writeFileSync(join(cwd, 'imagem.png'), 'PNG1'); return { code: 0, err: '' }; };
  const got = await generateImages({ prompt: 'x', outDir: dir, base: 'bom-dia', run, codexHome: tmp() });
  assert.deepEqual(got, [join(dir, 'bom-dia.png')]);
  assert.equal(readFileSync(got[0], 'utf8'), 'PNG1');
});

test('carrossel: entrega os slides em ordem, numerados', async () => {
  const dir = tmp();
  const run = async (args, input, cwd) => { for (const n of [10, 2, 1]) writeFileSync(join(cwd, `slide-${n}.png`), `S${n}`); return { code: 0, err: '' }; };
  const got = await generateImages({ prompt: 'x', format: 'carrossel', slides: 3, outDir: dir, base: 'dia-do-cafe', run, codexHome: tmp() });
  assert.deepEqual(got.map(f => readFileSync(f, 'utf8')), ['S1', 'S2', 'S10']);
  assert.match(got[2], /dia-do-cafe-03\.png$/);
});

test('sem arquivo na pasta: usa as imagens do Codex criadas depois do pedido', async () => {
  const home = tmp(), gen = join(home, 'generated_images', 'sessao');
  const dir = tmp();
  const run = async () => { mkdirSync(gen, { recursive: true }); writeFileSync(join(gen, 'ig_1.png'), 'PNG2'); return { code: 0, err: '' }; };
  const got = await generateImages({ prompt: 'x', outDir: dir, base: 'b', run, codexHome: home });
  assert.equal(readFileSync(got[0], 'utf8'), 'PNG2');
});

test('Codex falhou: erro claro e nada copiado', async () => {
  const dir = join(tmp(), 'nada');
  const run = async () => ({ code: 1, err: 'Not logged in' });
  await assert.rejects(generateImages({ prompt: 'x', outDir: dir, base: 'c', run, codexHome: tmp() }), /Codex falhou: Not logged in/);
  assert.equal(existsSync(dir), false);
});

test('generate_image só entra com a ferramenta "Gerar imagens" e o Codex disponível', () => {
  const names = (agent, ctx) => buildRipperBuiltinTools(agent, { settings: {}, ...ctx }).map(t => t.name);
  const images = { generate: async () => 'ok' };
  assert.ok(names({ tools: ['images'] }, { images }).includes('generate_image'));
  assert.ok(!names({ tools: [] }, { images }).includes('generate_image'));
  assert.ok(!names({ tools: ['images'] }, { images: null }).includes('generate_image'));
});
