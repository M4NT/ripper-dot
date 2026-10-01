import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceSendParts, createInputQueue, normalizeInputQueue } from '../lib/input-queue.mjs';

test('normalizeInputQueue limita janela e mantém enabled', () => {
  assert.deepEqual(normalizeInputQueue({ inputQueue: { enabled: false, windowMs: 99_999 } }), { enabled: false, windowMs: 10_000 });
  assert.deepEqual(normalizeInputQueue({}), { enabled: true, windowMs: 2500 });
});

test('coalesceSendParts junta textos e une anexos', () => {
  const merged = coalesceSendParts([
    { text: 'primeira', fileIds: ['f1'] },
    { text: 'segunda', fileIds: ['f2', 'f1'] }
  ]);
  assert.equal(merged.text, 'primeira\n\nsegunda');
  assert.deepEqual(merged.fileIds, ['f1', 'f2']);
});

test('createInputQueue agrupa envios na janela', () => {
  const out = [];
  let scheduled;
  const q = createInputQueue({
    enabled: true,
    windowMs: 2000,
    onFlush: batch => out.push(batch),
    schedule: (fn) => { scheduled = fn; return 1; },
    clearSchedule: () => { scheduled = null; }
  });
  q.enqueue({ text: 'a' });
  q.enqueue({ text: 'b' });
  assert.equal(out.length, 0);
  scheduled?.();
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'a\n\nb');
});

test('createInputQueue flush imediato no envio intencional', () => {
  const out = [];
  const timers = [];
  const q = createInputQueue({
    enabled: true,
    windowMs: 3000,
    onFlush: batch => out.push(batch),
    schedule: (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; },
    clearSchedule: clearTimeout
  });
  q.enqueue({ text: 'a' });
  q.enqueue({ text: 'b' }, { immediate: true });
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'a\n\nb');
  assert.equal(q.pendingCount(), 0);
  timers.forEach(clearTimeout);
});

test('flush esvazia fila; cancel descarta sem enviar', () => {
  const out = [];
  const q = createInputQueue({
    enabled: true,
    windowMs: 5000,
    onFlush: batch => out.push(batch),
    schedule: () => 1,
    clearSchedule: () => {}
  });
  q.enqueue({ text: 'x' });
  q.cancel();
  q.flush();
  assert.equal(out.length, 0);
  q.enqueue({ text: 'y' });
  q.flush();
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'y');
});

test('desabilitado envia cada mensagem sem agrupar', () => {
  const out = [];
  const q = createInputQueue({ enabled: false, windowMs: 2500, onFlush: batch => out.push(batch) });
  q.enqueue({ text: '1' });
  q.enqueue({ text: '2' });
  assert.equal(out.length, 2);
});
