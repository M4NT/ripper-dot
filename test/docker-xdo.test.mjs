import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_DISPLAY,
  XDOTOOL_MISSING,
  dockerComputer,
  runXdo,
  xdoCommand,
  xdoSpec,
  xdotoolPresent,
  xdotoolUnavailable
} from '../lib/docker.mjs';
import { DEFAULT_GEOMETRY, TYPE_MAX, typeTimeoutMs } from '../lib/computer-input.mjs';

test('xdoCommand: clique, movimento, digitação por stdin, teclas e rolagem sem shell', () => {
  assert.deepEqual(xdoCommand('move', { x: 10, y: 20 }).argv, ['mousemove', '--sync', '10', '20']);
  assert.deepEqual(xdoCommand('click', { x: 100, y: 200 }).argv, ['mousemove', '--sync', '100', '200', 'click', '1']);
  assert.deepEqual(xdoCommand('click', { x: 1, y: 2, button: 'right', count: 2 }).argv, ['mousemove', '--sync', '1', '2', 'click', '--repeat', '2', '3']);
  const typed = xdoCommand('type', { text: 'oi $(rm -rf /)' });
  assert.deepEqual(typed.argv, ['type', '--clearmodifiers', '--delay', '12', '--file', '-']);
  assert.equal(typed.stdin, 'oi $(rm -rf /)');
  assert.ok(!JSON.stringify(typed.argv).includes('oi'));
  assert.deepEqual(xdoCommand('key', { keys: 'Return' }).argv, ['key', '--clearmodifiers', '--', 'Return']);
  assert.deepEqual(xdoCommand('key', { keys: 'ctrl+a ctrl+c' }).argv, ['key', '--clearmodifiers', '--', 'ctrl+a', 'ctrl+c']);
  assert.deepEqual(xdoCommand('scroll', {}).argv, ['click', '--repeat', '3', '5']);
  assert.deepEqual(xdoCommand('scroll', { dy: -4 }).argv, ['click', '--repeat', '4', '4']);
  assert.deepEqual(xdoCommand('scroll', { dx: 2, dy: 1 }).argv, ['click', '--repeat', '1', '5', 'click', '--repeat', '2', '7']);
});

test('xdoCommand: rejeita coordenada fora da tela, tecla e texto inválidos', () => {
  assert.throws(() => xdoCommand('click', { x: -1, y: 0 }), /x deve ser/);
  assert.throws(() => xdoCommand('click', { x: 2000, y: 10 }, { geometry: DEFAULT_GEOMETRY }), /fora da tela/);
  assert.throws(() => xdoCommand('type', { text: '' }), /vazio/);
  assert.throws(() => xdoCommand('type', { text: 'x'.repeat(TYPE_MAX + 1) }), /2000/);
  assert.throws(() => xdoCommand('key', { keys: 'ctrl+c; rm -rf /' }), /inválidas/);
  assert.throws(() => xdoCommand('key', { keys: '$(reboot)' }), /inválidas/);
  assert.throws(() => xdoCommand('key', { keys: 'alt+Tab' }), /não permitida/);
  assert.throws(() => xdoCommand('scroll', { dy: 0, dx: 0 }), /Informe dy/);
  assert.throws(() => xdoCommand('click', { x: 1, y: 1, button: 'frente' }), /button/);
  const clipped = xdoCommand('scroll', { dy: 50 });
  assert.match(clipped.note, /limitada a 20/);
  assert.deepEqual(clipped.argv, ['click', '--repeat', '20', '5']);
});

test('xdoSpec: timeout no contêiner e texto só no stdin', () => {
  const spec = xdoSpec('type', { text: 'abc' });
  assert.deepEqual(spec.argv.slice(0, 4), ['timeout', '--kill-after=2', `${Math.ceil(typeTimeoutMs(3) / 1000)}s`, 'xdotool']);
  assert.ok(spec.argv.includes('--file'));
  assert.equal(spec.stdin, 'abc');
  assert.ok(spec.timeoutMs > typeTimeoutMs(3));
});

test('xdotool ausente e timeout 124: erros claros', async () => {
  assert.equal(xdotoolPresent({ code: 0, out: '/usr/bin/xdotool\n' }), true);
  assert.equal(xdotoolPresent({ code: 1, out: '' }), false);
  assert.equal(xdotoolUnavailable({ code: 127, err: '' }), true);
  assert.equal(xdotoolUnavailable({ code: 1, err: 'OCI runtime exec failed: exec: "xdotool": executable file not found in $PATH' }), true);

  await assert.rejects(runXdo(async () => ({ code: 0 }), 'click', { x: 1, y: 1 }, {
    probe: async () => ({ code: 1, out: '' })
  }), e => e.message === XDOTOOL_MISSING);

  await assert.rejects(runXdo(async () => ({ code: 127, err: 'xdotool: not found' }), 'move', { x: 0, y: 0 }), e => e.message === XDOTOOL_MISSING);

  const calls = [];
  assert.equal(await runXdo(async spec => {
    calls.push(spec);
    return { code: 0, out: '' };
  }, 'type', { text: 'abc' }), 'ok');
  assert.equal(calls[0].stdin, 'abc');
  assert.ok(calls[0].argv.includes('--file'));
  assert.ok(!calls[0].argv.includes('abc'));

  await assert.rejects(runXdo(async () => ({ code: 124, err: '' }), 'type', { text: 'abc' }), /estourou o tempo.*xdotool encerrado/);
  await assert.rejects(runXdo(async () => ({ code: 1, err: 'XOpenDisplay failed' }), 'key', { keys: 'Return' }), /mouse\/teclado/);
});

test('dockerComputer expõe mouse/teclado e usa o display da VM', () => {
  const pc = dockerComputer({ id: 'abc123def456', name: 'Teste' }, { dockerMemory: '1g', dockerCpus: 1 });
  assert.equal(pc.kind, 'docker');
  for (const m of ['click', 'type', 'key', 'move', 'scroll']) assert.equal(typeof pc[m], 'function', m);
  assert.equal(AGENT_DISPLAY, ':99');
  assert.match(XDOTOOL_MISSING, /xdotool não está instalado/);
});
