import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('gravação do db.json que falha tenta de novo sozinha (não perde a mudança)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripper-flush-'));
  process.env.RIPPER_DATA = dir;
  const store = await import('../lib/store.mjs');
  store._resetStoreForTests();
  const db = store.load();
  store.flush();
  const origErr = console.error; console.error = () => {}; // a falha é esperada aqui
  try {
    writeFileSync(join(dir, 'db.json'), '{ quebrado'); // leitura do disco falha → gravação falha
    db.settings.name = 'Nome Salvo Depois';
    store.flush();
    assert.ok(!readFileSync(join(dir, 'db.json'), 'utf8').includes('Nome Salvo Depois'));
    rmSync(join(dir, 'db.json')); // o problema passa
    let disk = '';
    for (let i = 0; i < 40 && !disk.includes('Nome Salvo Depois'); i++) { await new Promise(r => setTimeout(r, 100)); try { disk = readFileSync(join(dir, 'db.json'), 'utf8'); } catch {} }
    assert.match(disk, /Nome Salvo Depois/, 'gravou na nova tentativa, sem ninguém chamar save()');
  } finally { console.error = origErr; store._resetStoreForTests(); }
});
