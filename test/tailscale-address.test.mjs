import test from 'node:test';
import assert from 'node:assert/strict';
import { tailscaleAddress, lanAddress } from '../lib/pairing.mjs';

test('acha o IP do Tailscale (100.64/10) e não confunde com a rede de casa', () => {
  const ifs = {
    'Wi-Fi': [{ family: 'IPv4', address: '192.168.0.10', internal: false }],
    Tailscale: [{ family: 'IPv4', address: '100.101.5.9', internal: false }],
    Outro: [{ family: 'IPv4', address: '100.10.0.1', internal: false }] // 100.x fora da faixa do Tailscale
  };
  assert.equal(tailscaleAddress(ifs), '100.101.5.9');
  assert.equal(lanAddress(ifs), '192.168.0.10');
  assert.equal(tailscaleAddress({ 'Wi-Fi': ifs['Wi-Fi'] }), null);
});
