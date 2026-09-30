import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMcpServer } from '../lib/mcp-probe.mjs';

test('verifyMcpServer rejeita URL não HTTPS', async () => {
  const r = await verifyMcpServer('http://example.com/mcp');
  assert.equal(r.ok, false);
  assert.match(r.steps[0].detail, /HTTPS/i);
});
