import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceSendParts, createInputQueue, normalizeInputQueue } from '../lib/input-queue.mjs';

test('normalizeInputQueue limita janela e mantém enabled', () => {
  assert.deepEqual(normalizeInputQueue({ inputQueue: { enabled: false, windowMs: 99_999 } }), { enabled: false, windowMs: 10_000 });
  assert.deepEqual(normalizeInputQueue({}), { enabled: false, windowMs: 2500 }, 'padrão: manda na hora');
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
  q.cancel();
});

test('createInputQueue flush imediato no envio intencional', () => {
  const out = [];
  let timerId;
  const q = createInputQueue({
    enabled: true,
    windowMs: 3000,
    onFlush: batch => out.push(batch),
    schedule: (fn, ms) => { timerId = setTimeout(fn, ms); return timerId; },
    clearSchedule: id => { clearTimeout(id); timerId = null; }
  });
  try {
    q.enqueue({ text: 'a' });
    q.enqueue({ text: 'b' }, { immediate: true });
    assert.equal(out.length, 1);
    assert.equal(out[0].text, 'a\n\nb');
    assert.equal(q.pendingCount(), 0);
  } finally {
    if (timerId != null) clearTimeout(timerId);
    q.cancel();
  }
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
  q.cancel();
});

test('desabilitado envia cada mensagem sem agrupar', () => {
  const out = [];
  const q = createInputQueue({ enabled: false, windowMs: 2500, onFlush: batch => out.push(batch) });
  q.enqueue({ text: '1' });
  q.enqueue({ text: '2' });
  assert.equal(out.length, 2);
  q.cancel();
});

test('scheduleFlush não deixa timer pendente após cancel', () => {
  let pendingId;
  const q = createInputQueue({
    enabled: true,
    windowMs: 60_000,
    onFlush: () => {},
    schedule: (fn, ms) => { pendingId = setTimeout(fn, ms); return pendingId; },
    clearSchedule: id => { clearTimeout(id); pendingId = null; }
  });
  q.enqueue({ text: 'pendente' });
  q.cancel();
  assert.equal(pendingId, null);
});
