import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

test('Boat usa os endpoints de sandbox, comandos e arquivos', async () => {
  const calls = [];
  const server = createServer(async (req, res) => {
    const body = await new Promise(resolve => { let s = ''; req.on('data', c => s += c); req.on('end', () => resolve(s ? JSON.parse(s) : null)); });
    calls.push({ method: req.method, path: req.url, body });
    res.setHeader('content-type', 'application/json');
    const value = req.url === '/sandboxes' ? { sandbox: { id: 's1' } }
      : req.url === '/sandboxes/s1' ? { sandbox: { state: 'ready' } }
      : req.url.endsWith('/commands') ? { stdout: 'ok', stderr: '', exitCode: 0 }
      : req.url.endsWith('/host') ? { url: 'https://example.test' } : { ok: true };
    res.end(JSON.stringify(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.BOAT_API_URL = `http://127.0.0.1:${server.address().port}`;
    const { computerFor } = await import('../lib/boat.mjs');
    const agent = { id: 'a', name: 'Ana', vmId: null };
    const settings = { computer: { mode: 'boat', boatApiKey: 'test', vmSize: 'small', idleStopMinutes: 1 } };
    const computer = computerFor(agent, settings, () => {});
    assert.match(await computer.exec('pwd'), /ok/);
    await computer.writeFile('note.txt', Buffer.from('olá'));
    assert.equal(await computer.share(3000), 'https://example.test');
    assert.equal(agent.vmId, 's1');
    assert.deepEqual(calls[0], { method: 'POST', path: '/sandboxes', body: { type: 'small' } });
    assert.ok(calls.some(c => c.path === '/sandboxes/s1/files' && c.body.encoding === 'base64'));
    assert.ok(calls.some(c => c.path === '/sandboxes/s1/host' && c.body.port === 3000));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
