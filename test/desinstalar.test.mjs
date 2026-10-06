import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { dataPaths } from '../scripts/desinstalar.mjs';

test('desinstalar: sabe onde estão os dados (pasta de dados e ~/.ripper)', () => {
  assert.deepEqual(dataPaths({}, '/app', '/home/u'), [join('/app', 'data'), join('/home/u', '.ripper')]);
  assert.deepEqual(dataPaths({ RIPPER_DATA: '/var/ripper' }, '/app', '/home/u')[0], resolve('/var/ripper'));
});
