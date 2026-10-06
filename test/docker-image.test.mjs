import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickOutdated, IMAGE, containerNameOf, hostnameOf, wsKeyOf } from '../lib/docker.mjs';

test('pickOutdated: tag legada mais nova só quando falta a atual', () => {
  assert.equal(pickOutdated(['ripper-agent:1', 'ripper-agent:2', '']), 'ripper-agent:2');
  assert.equal(pickOutdated(['ripper-agent:1']), 'ripper-agent:1');
  assert.equal(pickOutdated(['ripper-agent:2', IMAGE]), null);
  assert.equal(pickOutdated(['node:22-bookworm', 'outra:latest']), null);
  assert.equal(pickOutdated([]), null);
});

test('um contêiner por (agente, pasta): nome e alias estáveis, padrão mantém o nome antigo', () => {
  const id = '0123456789abcdef-rest';
  const agent = { id, name: 'Donald Pato' };
  assert.equal(containerNameOf(id), 'ripper-0123456789ab');
  assert.equal(containerNameOf(id, wsKeyOf(null)), 'ripper-0123456789ab');
  assert.equal(containerNameOf(id, wsKeyOf({ kind: 'repo', repo: 'a/b' })), 'ripper-0123456789ab');
  assert.equal(hostnameOf(agent), 'donald-pato');
  const a = wsKeyOf({ kind: 'folder', path: '/x/a' });
  const b = wsKeyOf({ kind: 'folder', path: '/x/b' });
  const aro = wsKeyOf({ kind: 'folder', path: '/x/a', readOnly: true });
  assert.match(containerNameOf(id, a), /^ripper-0123456789ab-[0-9a-f]{8}$/);
  assert.equal(containerNameOf(id, a), containerNameOf(id, wsKeyOf({ kind: 'folder', path: '/x/a' })));
  assert.equal(new Set([containerNameOf(id, a), containerNameOf(id, b), containerNameOf(id, aro), containerNameOf(id)]).size, 4);
  assert.equal(hostnameOf(agent, a), `donald-pato-${containerNameOf(id, a).slice(-8)}`);
});
