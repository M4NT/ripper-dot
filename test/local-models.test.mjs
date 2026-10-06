import test from 'node:test';
import assert from 'node:assert/strict';
import { pickModel, usableGb } from '../lib/local-models.mjs';

test('pickModel: VRAM NVIDIA manda', () => {
  assert.equal(pickModel({ ramGb: 64, vramGb: 12 }).id, 'qwen3:14b');
  assert.equal(pickModel({ ramGb: 8, vramGb: 24 }).id, 'qwen3:32b');
});
test('pickModel: Apple Silicon usa 70% da RAM unificada', () => {
  assert.equal(usableGb({ ramGb: 16, appleSilicon: true }), 16 * 0.7);
  assert.equal(pickModel({ ramGb: 16, appleSilicon: true }).id, 'qwen3:14b');
});
test('pickModel: só CPU usa metade da RAM; pouca memória = nenhum', () => {
  assert.equal(pickModel({ ramGb: 16 }).id, 'qwen3:8b');
  assert.equal(pickModel({ ramGb: 2 }), null);
});
