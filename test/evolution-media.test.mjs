import test from 'node:test';
import assert from 'node:assert/strict';
import { evolutionMedia, withMediaText } from '../lib/evolution.mjs';

test('evolutionMedia reconhece áudio e imagem; withMediaText troca por texto', () => {
  const ev = m => ({ event: 'messages.upsert', data: { key: { id: 'x' }, message: m } });
  assert.deepEqual(evolutionMedia(ev({ audioMessage: {} })), { kind: 'audio', caption: '' });
  assert.deepEqual(evolutionMedia(ev({ imageMessage: { caption: 'nota' } })), { kind: 'image', caption: 'nota' });
  assert.equal(evolutionMedia(ev({ conversation: 'oi' })), null);
  assert.equal(withMediaText(ev({ audioMessage: {} }), 'olá').data.message.conversation, 'olá');
});
