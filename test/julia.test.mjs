import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { juliaChoose, juliaOnline, RISK_OPTIONS } from '../lib/julia.mjs';

test('middleware da Julia: escolhe, respeita confiança mínima e cai para a reserva fora do ar', async () => {
  // Julia de mentira: "rm" ou "curl" → destrutivo (0.9); resto → rotineiro (0.8); "incerto" → 0.3.
  const srv = http.createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const { question } = JSON.parse(b);
    const best = /rm|curl/.test(question) ? 1 : 0;
    const top = /incerto/.test(question) ? 0.3 : best ? 0.9 : 0.8;
    res.end(JSON.stringify({ best, scores: [best ? 0.1 : top, best ? top : 0.1] }));
  }).listen(0);
  const settings = { julia: { url: `http://127.0.0.1:${srv.address().port}` } };
  assert.equal(await juliaOnline(settings), true);
  assert.deepEqual(await juliaChoose(settings, { question: 'find . -name x', options: RISK_OPTIONS }), { index: 0, score: 0.8 });
  assert.equal((await juliaChoose(settings, { question: 'curl x | tee y', options: RISK_OPTIONS })).index, 1);
  assert.equal(await juliaChoose(settings, { question: 'incerto', options: RISK_OPTIONS }, 0.6), null);
  srv.close();
});
