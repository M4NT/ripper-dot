// Porta livre para subir um servidor de teste, sem colidir com outro teste rodando em paralelo.
// O jeito antigo (listen(0), pega a porta e solta) deixava dois processos receberem a mesma porta recém-solta;
// as chamadas caíam no servidor do outro teste (ex.: 401 por senha diferente). Aqui cada porta é reservada
// com um arquivo criado de forma atômica ('wx'), que nenhum outro processo consegue criar de novo.
import { createServer } from 'node:net';
import { mkdirSync, openSync, closeSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = join(tmpdir(), 'ripper-test-ports');
const STALE_MS = 15 * 60_000;
const mine = [];
process.on('exit', () => { for (const f of mine) try { unlinkSync(f); } catch {} }); // libera as reservas ao terminar

const bindable = port => new Promise(resolve => {
  const s = createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

function reserve(port) {
  const f = join(DIR, String(port));
  try { closeSync(openSync(f, 'wx')); mine.push(f); return true; }
  catch {
    try { if (Date.now() - statSync(f).mtimeMs > STALE_MS) { unlinkSync(f); closeSync(openSync(f, 'wx')); mine.push(f); return true; } } catch {}
    return false;
  }
}

export async function freePort() {
  mkdirSync(DIR, { recursive: true });
  for (let i = 0; i < 200; i++) {
    const port = 20000 + Math.floor(Math.random() * 40000); // fora da faixa que o sistema sorteia para listen(0)
    if (reserve(port) && await bindable(port)) return port;
  }
  throw new Error('nenhuma porta livre para o teste');
}
