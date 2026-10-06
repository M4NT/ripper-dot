// Modelos locais: detecta o hardware, escolhe o melhor modelo que cabe e baixa pelo Ollama.
// ponytail: tabela curta curada (ideia do llmfit, MIT); trocar por `llmfit recommend --json` se a tabela envelhecer.
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

// Do melhor para o pior; gb = memória necessária (pesos Q4 + contexto). Todos aceitam ferramentas no Ollama.
export const LOCAL_MODELS = [
  { id: 'qwen3:32b', label: 'Qwen3 32B', gb: 22 },
  { id: 'qwen3:14b', label: 'Qwen3 14B', gb: 11 },
  { id: 'qwen3:8b', label: 'Qwen3 8B', gb: 6.5 },
  { id: 'qwen3:4b', label: 'Qwen3 4B', gb: 3.5 },
  { id: 'qwen3:1.7b', label: 'Qwen3 1.7B', gb: 2 }
];

/** Memória utilizável pelo modelo: VRAM da GPU NVIDIA; Apple Silicon ~70% da RAM unificada; senão metade da RAM (CPU). */
export function usableGb(hw) {
  if (hw.vramGb) return hw.vramGb;
  if (hw.appleSilicon) return hw.ramGb * 0.7;
  return hw.ramGb * 0.5;
}

export const pickModel = hw => LOCAL_MODELS.find(m => m.gb <= usableGb(hw)) || null;

export async function detectHardware() {
  const hw = { ramGb: +(os.totalmem() / 2 ** 30).toFixed(1), appleSilicon: process.platform === 'darwin' && process.arch === 'arm64', gpu: null, vramGb: 0 };
  try {
    const { stdout } = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 5000 });
    const rows = stdout.trim().split('\n').map(l => l.split(',').map(s => s.trim())).filter(r => r[1]);
    if (rows.length) { hw.gpu = rows[0][0]; hw.vramGb = +(Math.max(...rows.map(r => +r[1])) / 1024).toFixed(1); }
  } catch { /* sem NVIDIA */ }
  return hw;
}

const base = s => String(s?.ollama?.url || 'http://127.0.0.1:11434').replace(/\/+$/, '');

export async function ollamaUp(settings) {
  try { return (await fetch(`${base(settings)}/api/version`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

/** Baixa o modelo; onProgress({ status, pct }). Lança se o Ollama recusar. */
export async function pullModel(settings, model, onProgress) {
  const r = await fetch(`${base(settings)}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
  if (!r.ok) throw new Error(`Ollama respondeu ${r.status}`);
  let buf = '';
  for await (const chunk of r.body.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines.filter(Boolean)) {
      const e = JSON.parse(l);
      if (e.error) throw new Error(e.error);
      onProgress({ status: e.status, pct: e.total ? Math.round(100 * e.completed / e.total) : null });
    }
  }
}
