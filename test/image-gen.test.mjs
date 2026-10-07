import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateImage, imageGenArgs, imageGenPrompt } from '../lib/image-gen.mjs';
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

test('copia a imagem salva na pasta de trabalho', async () => {
  const out = join(tmp(), 'arte', 'bom-dia.png');
  const run = async (args, input, cwd) => { writeFileSync(join(cwd, 'imagem.png'), 'PNG1'); return { code: 0, err: '' }; };
  const got = await generateImage({ prompt: 'x', outFile: out, run, codexHome: tmp() });
  assert.equal(got, out);
  assert.equal(readFileSync(out, 'utf8'), 'PNG1');
});

test('sem arquivo na pasta: usa a imagem mais nova do Codex, criada depois do pedido', async () => {
  const home = tmp(), gen = join(home, 'generated_images', 'sessao');
  const out = join(tmp(), 'b.png');
  const run = async () => { mkdirSync(gen, { recursive: true }); writeFileSync(join(gen, 'ig_1.png'), 'PNG2'); return { code: 0, err: '' }; };
  await generateImage({ prompt: 'x', outFile: out, run, codexHome: home });
  assert.equal(readFileSync(out, 'utf8'), 'PNG2');
});

test('Codex falhou: erro claro e nada copiado', async () => {
  const out = join(tmp(), 'c.png');
  const run = async () => ({ code: 1, err: 'Not logged in' });
  await assert.rejects(generateImage({ prompt: 'x', outFile: out, run, codexHome: tmp() }), /Codex falhou: Not logged in/);
  assert.equal(existsSync(out), false);
});

test('generate_image só entra com a ferramenta "Gerar imagens" e o Codex disponível', () => {
  const names = (agent, ctx) => buildRipperBuiltinTools(agent, { settings: {}, ...ctx }).map(t => t.name);
  const images = { generate: async () => 'ok' };
  assert.ok(names({ tools: ['images'] }, { images }).includes('generate_image'));
  assert.ok(!names({ tools: [] }, { images }).includes('generate_image'));
  assert.ok(!names({ tools: ['images'] }, { images: null }).includes('generate_image'));
});
