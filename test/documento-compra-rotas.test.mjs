import './helpers/signed-in.mjs';
// Rotas do cartão de documento de compra: Aprovar cria pedido na Caixa, Rejeitar não cria nada, e a Caixa decide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/free-port.mjs';

const EMPRESA = '11222333000181';
const FORN = '11444777000161';
const chave = ({ cnpj, numero, mod = '55' }) => ['35', '2609', cnpj, mod, '001', String(numero).padStart(9, '0'), '1', '12345678', '0'].join('');
const CHAVE_A = chave({ cnpj: FORN, numero: 500 }); // aprovada na Caixa
const CHAVE_B = chave({ cnpj: FORN, numero: 501 }); // rejeitada direto
const CHAVE_C = chave({ cnpj: FORN, numero: 502 }); // pedido antigo, pendente ao reiniciar
const nota = (chNFe, numero) => ({ chNFe, xNome: `FORNECEDOR ${numero}`, cnpjEmitente: FORN, vNF: 1500, dhEmi: '2026-10-05T09:00:00-03:00', ciencia: true });

test('cartão: aprovar cria pedido na Caixa, Rejeitar não cria, a Caixa decide e o pedido antigo sobrevive ao reinício', async () => {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'ripper-documento-rotas-'));
  writeFileSync(join(dataDir, 'db.json'), JSON.stringify({
    dfe: {
      certs: { [EMPRESA]: { cnpj: EMPRESA } },
      companies: { [EMPRESA]: { notes: { [CHAVE_A]: nota(CHAVE_A, 500), [CHAVE_B]: nota(CHAVE_B, 501), [CHAVE_C]: nota(CHAVE_C, 502) } } },
      nfse: {}
    },
    approvals: [{ id: 'antiga', kind: 'documento', status: 'pending', command: 'NF-e nº 502', reason: 'teste', createdAt: Date.now(), docRef: { empresa: EMPRESA, chNFe: CHAVE_C } }],
    documentos: { [`${EMPRESA}:${CHAVE_C}`]: { chNFe: CHAVE_C, empresa: EMPRESA, approvalId: 'antiga', rejeitadoEm: null, criadoEm: Date.now() } }
  }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, RIPPER_DATA: dataDir, PORT: String(port), HOST: '127.0.0.1', RIPPER_TEST_PROVIDER: 'stream', HOME: dataDir, USERPROFILE: dataDir, JULIA_AUTOSTART: '0', RIPPER_VAULT_KEY: 'documento-rotas-vault' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (path, b) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(b ?? {}) });
  const get = path => fetch(base + path).then(r => r.json());
  const wait = async (fn, ms = 60_000) => { let v; for (let i = 0; i < ms / 150 && !(v = await fn()); i++) await new Promise(r => setTimeout(r, 150)); return v; };
  try {
    await wait(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } });

    // Reinício: o pedido de documento pendente não é marcado como expirado.
    const pendentes = await get('/api/approvals');
    assert.ok(pendentes.pending.some(a => a.id === 'antiga'), 'pedido do cartão sobrevive ao reinício');
    assert.deepEqual(await get(`/api/documentos/${EMPRESA}/${CHAVE_C}`), { estado: 'aguardando', approvalId: 'antiga', decididoEm: null });

    // Nada decidido ainda.
    assert.deepEqual(await get(`/api/documentos/${EMPRESA}/${CHAVE_A}`), { estado: 'nenhum' });

    // Aprovar: cria pedido na Caixa, com o texto da nota e sem agente.
    const ap = await post(`/api/documentos/${EMPRESA}/${CHAVE_A}/aprovar`, { etiquetas: ['completo'] });
    assert.equal(ap.status, 200);
    const estadoA = await ap.json();
    assert.equal(estadoA.estado, 'aguardando');
    const caixa = (await get('/api/approvals')).pending.find(a => a.id === estadoA.approvalId);
    assert.ok(caixa, 'o pedido aparece na Caixa');
    assert.equal(caixa.kind, 'documento');
    assert.match(caixa.command, /NF-e nº 500 de FORNECEDOR 500 · .*completo/);
    assert.equal(caixa.agentId, null);

    // Clicar de novo não cria outro pedido.
    const de2 = await (await post(`/api/documentos/${EMPRESA}/${CHAVE_A}/aprovar`, { etiquetas: ['completo'] })).json();
    assert.equal(de2.approvalId, estadoA.approvalId);

    // A Caixa decide (aprovar): o cartão mostra Aprovado. Nada é lançado no ERP nesse caminho.
    assert.equal((await post(`/api/approvals/${estadoA.approvalId}`, { approve: true })).status, 200);
    assert.equal((await get(`/api/documentos/${EMPRESA}/${CHAVE_A}`)).estado, 'aprovado');
    assert.equal((await post(`/api/documentos/${EMPRESA}/${CHAVE_A}/rejeitar`)).status, 409, 'aprovado não se rejeita');

    // Rejeitar direto: não cria nada na Caixa e não avisa.
    const antesDaCaixa = (await get('/api/approvals')).pending.length;
    const rej = await post(`/api/documentos/${EMPRESA}/${CHAVE_B}/rejeitar`);
    assert.equal(rej.status, 200);
    assert.equal((await rej.json()).estado, 'rejeitado');
    assert.equal((await get('/api/approvals')).pending.length, antesDaCaixa, 'rejeitar não cria pedido na Caixa');

    // Aprovar depois de rejeitado abre pedido; rejeitar com pedido aberto cancela o pedido.
    const ap2 = await (await post(`/api/documentos/${EMPRESA}/${CHAVE_B}/aprovar`, { etiquetas: [] })).json();
    assert.equal(ap2.estado, 'aguardando');
    assert.equal((await post(`/api/documentos/${EMPRESA}/${CHAVE_B}/rejeitar`)).status, 200);
    const recentes = (await get('/api/approvals')).recent;
    assert.ok(recentes.some(a => a.id === ap2.approvalId && a.status === 'cancelled'), 'o pedido cancelado fica no histórico');

    // Empresa sem certificado ou nota fora da base: 404.
    assert.equal((await post(`/api/documentos/99888777000166/${CHAVE_A}/aprovar`, {})).status, 404);
    assert.equal((await post(`/api/documentos/${EMPRESA}/${chave({ cnpj: FORN, numero: 999 })}/aprovar`, {})).status, 404);
  } finally { child.kill(); }
});
