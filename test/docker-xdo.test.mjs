import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_DISPLAY,
  XDOTOOL_MISSING,
  dockerComputer,
  runXdo,
  xdoCommand,
  xdotoolPresent,
  xdotoolUnavailable
} from '../lib/docker.mjs';

test('xdoCommand: clique, movimento, digitação, teclas e rolagem sem shell', () => {
  assert.deepEqual(xdoCommand('move', { x: 10, y: 20 }), ['mousemove', '--sync', '10', '20']);
  assert.deepEqual(xdoCommand('click', { x: 100, y: 200 }), ['mousemove', '--sync', '100', '200', 'click', '1']);
  assert.deepEqual(xdoCommand('click', { x: 1, y: 2, button: 'right', count: 2 }), ['mousemove', '--sync', '1', '2', 'click', '--repeat', '2', '3']);
  assert.deepEqual(xdoCommand('type', { text: 'oi $(rm -rf /)' }), ['type', '--clearmodifiers', '--delay', '12', '--', 'oi $(rm -rf /)']);
  assert.deepEqual(xdoCommand('key', { keys: 'Return' }), ['key', '--clearmodifiers', '--', 'Return']);
  assert.deepEqual(xdoCommand('key', { keys: 'ctrl+a ctrl+c' }), ['key', '--clearmodifiers', '--', 'ctrl+a', 'ctrl+c']);
  assert.deepEqual(xdoCommand('scroll', {}), ['click', '--repeat', '3', '5']);
  assert.deepEqual(xdoCommand('scroll', { dy: -4 }), ['click', '--repeat', '4', '4']);
  assert.deepEqual(xdoCommand('scroll', { dx: 2, dy: 1 }), ['click', '--repeat', '1', '5', 'click', '--repeat', '2', '7']);
});

test('xdoCommand: rejeita coordenada, tecla e texto inválidos', () => {
  assert.throws(() => xdoCommand('click', { x: -1, y: 0 }), /x deve ser/);
  assert.throws(() => xdoCommand('type', { text: '' }), /vazio/);
  assert.throws(() => xdoCommand('key', { keys: 'ctrl+c; rm -rf /' }), /inválidas/);
  assert.throws(() => xdoCommand('key', { keys: '$(reboot)' }), /inválidas/);
  assert.throws(() => xdoCommand('scroll', { dy: 0, dx: 0 }), /Informe dy/);
  assert.throws(() => xdoCommand('click', { x: 1, y: 1, button: 'frente' }), /button/);
});

test('xdotool ausente: probe vazio, exit 127 e "not found" viram o mesmo erro claro', async () => {
  assert.equal(xdotoolPresent({ code: 0, out: '/usr/bin/xdotool\n' }), true);
  assert.equal(xdotoolPresent({ code: 1, out: '' }), false);
  assert.equal(xdotoolUnavailable({ code: 127, err: '' }), true);
  assert.equal(xdotoolUnavailable({ code: 1, err: 'OCI runtime exec failed: exec: "xdotool": executable file not found in $PATH' }), true);
  assert.equal(xdotoolUnavailable({ code: 0, out: '' }), false);

  await assert.rejects(runXdo(async () => ({ code: 0 }), 'click', { x: 1, y: 1 }, {
    probe: async () => ({ code: 1, out: '' })
  }), e => e.message === XDOTOOL_MISSING);

  await assert.rejects(runXdo(async () => ({ code: 127, err: 'xdotool: not found' }), 'move', { x: 0, y: 0 }), e => e.message === XDOTOOL_MISSING);

  const calls = [];
  assert.equal(await runXdo(async argv => {
    calls.push(argv);
    return { code: 0, out: '' };
  }, 'type', { text: 'abc' }), 'ok');
  assert.deepEqual(calls[0], ['type', '--clearmodifiers', '--delay', '12', '--', 'abc']);

  await assert.rejects(runXdo(async () => ({ code: 1, err: 'XOpenDisplay failed' }), 'key', { keys: 'Return' }), /mouse\/teclado/);
});

test('dockerComputer expõe mouse/teclado e usa o display da VM', () => {
  const pc = dockerComputer({ id: 'abc123def456', name: 'Teste' }, { dockerMemory: '1g', dockerCpus: 1 });
  assert.equal(pc.kind, 'docker');
  for (const m of ['click', 'type', 'key', 'move', 'scroll']) assert.equal(typeof pc[m], 'function', m);
  assert.equal(AGENT_DISPLAY, ':99');
  assert.match(XDOTOOL_MISSING, /xdotool não está instalado/);
});
