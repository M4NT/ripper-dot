import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Context Pool: guarda, encontra por tarefa parecida, atualiza e apaga', async () => {
  process.env.RIPPER_DATA = mkdtempSync(join(tmpdir(), 'ripper-pool-'));
  const { _resetStoreForTests } = await import('../lib/store.mjs');
  _resetStoreForTests();
  const pool = await import('../lib/script-pool.mjs');
  pool._resetScriptPoolForTests();

  pool.saveScript({ task: 'Converter planilha CSV de vendas para JSON', lang: 'python', code: 'import csv, json' }, 'a1');
  pool.saveScript({ task: 'Comprimir imagens PNG da pasta', lang: 'sh', code: 'pngquant *.png' });
  assert.match(pool.findScriptTool('converter csv de vendas em json'), /import csv, json/);
  assert.match(pool.findScriptTool('previsão do tempo'), /Nenhum script parecido/);
  assert.equal(pool.listScripts().find(s => s.lang === 'python').uses, 1); // contou o uso

  // mesma tarefa + linguagem: atualiza no lugar (não duplica)
  pool.saveScript({ task: 'Converter planilha CSV de vendas para JSON', lang: 'python', code: 'import csv, json  # v2' });
  assert.equal(pool.listScripts().length, 2);
  assert.match(pool.findScriptTool('csv vendas json'), /v2/);

  assert.throws(() => pool.saveScript({ task: '', code: 'x' }));
  assert.equal(pool.deleteScript(pool.listScripts()[0].id), true);
  assert.equal(pool.listScripts().length, 1);
});
