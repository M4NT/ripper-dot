// Computador gratuito: um contêiner Docker por agente, a partir da imagem de referência do Ripper
// (Chromium + tela virtual + noVNC já instalados, então criar a VM leva segundos).
// Todos os contêineres ficam na rede "ripper-net": cada agente é alcançável pelo nome (ex.: http://donald:3000)
// e todos compartilham /shared para trocar arquivos.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataUrl } from './store.mjs';

export const IMAGE = 'ripper-agent:2';
const LEGACY_IMAGES = new Set(['', 'node:22-bookworm', 'ripper-agent:1']);
const NETWORK = 'ripper-net';
const PORTS = [3000, 5173, 8000, 8080];        // portas que o agente pode compartilhar
const VNC_PORT = 6080;                         // tela da VM pela web (noVNC)
const MAX_OUT = 20_000;
const idle = new Map();
let building = null;

function docker(args, { timeout = 60_000, input } = {}) {
  return new Promise(resolve => {
    const p = spawn('docker', args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', d => { if (out.length < MAX_OUT * 2) out += d; });
    p.stderr.on('data', d => { if (err.length < MAX_OUT) err += d; });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out: '', err: e.message }); });
    p.on('close', code => { clearTimeout(t); resolve({ code, out, err }); });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

export async function dockerAvailable() {
  const r = await docker(['info', '--format', '{{.ServerVersion}}'], { timeout: 8000 });
  return r.code === 0 ? r.out.trim() : null;
}

/** Garante a imagem de referência (constrói uma vez, a partir de docker/agent). */
export async function ensureImage(image = IMAGE) {
  if ((await docker(['image', 'inspect', image], { timeout: 15_000 })).code === 0) return;
  if (image !== IMAGE) {
    const r = await docker(['pull', image], { timeout: 600_000 });
    if (r.code !== 0) throw new Error(`Não consegui baixar a imagem ${image}: ` + r.err.trim().slice(-300));
    return;
  }
  building ||= docker(['build', '-t', IMAGE, fileURLToPath(new URL('../docker/agent/', import.meta.url))], { timeout: 1_200_000 })
    .finally(() => { building = null; });
  const r = await building;
  if (r.code !== 0) throw new Error('Não consegui construir a imagem de referência: ' + (r.err || r.out).trim().slice(-300));
}

export async function imageStatus() {
  return (await docker(['image', 'inspect', '-f', '{{.Created}}', IMAGE], { timeout: 10_000 })).code === 0 ? 'ready' : building ? 'building' : 'missing';
}

async function ensureNetwork() {
  if ((await docker(['network', 'inspect', NETWORK], { timeout: 10_000 })).code !== 0) await docker(['network', 'create', NETWORK]);
}

const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agente';
export const hostnameOf = agent => slug(agent.name);

export function dockerComputer(agent, settings) {
  const name = `ripper-${agent.id.slice(0, 12)}`;
  const image = LEGACY_IMAGES.has(settings.dockerImage || '') ? IMAGE : settings.dockerImage;
  const dir = dataUrl(`sandbox/${agent.id}/`);
  const shared = dataUrl('shared/');
  mkdirSync(new URL('uploads/', dir), { recursive: true });
  mkdirSync(shared, { recursive: true });

  async function inspect() {
    const r = await docker(['inspect', '-f', '{{.State.Running}}|{{.Image}}', name], { timeout: 10_000 });
    if (r.code !== 0) return { state: 'not started' };
    const [running, imageId] = r.out.trim().split('|');
    return { state: running === 'true' ? 'running' : 'stopped', imageId };
  }
  async function create() {
    await ensureImage(image);
    await ensureNetwork();
    const r = await docker(['run', '-d', '--name', name, '--label', 'ripper=1', '--label', `ripper.agent=${agent.id}`,
      '--hostname', hostnameOf(agent), '--network', NETWORK, '--network-alias', hostnameOf(agent),
      '-v', `${fileURLToPath(dir)}:/work`, '-v', `${fileURLToPath(shared)}:/shared`, '-w', '/work',
      '--memory', '2g', '--cpus', '2', '--shm-size', '512m',
      ...[...PORTS, VNC_PORT].flatMap(p => ['-p', `127.0.0.1::${p}`]), image], { timeout: 300_000 });
    if (r.code !== 0) throw new Error('Docker não conseguiu criar o computador: ' + (r.err || r.out).trim().slice(-300));
  }
  async function ensure() {
    const st = await inspect();
    // Contêiner de uma versão antiga da imagem (ou de outra imagem): recria. Os arquivos ficam em /work e /shared.
    if (st.state !== 'not started') {
      const want = (await docker(['image', 'inspect', '-f', '{{.Id}}', image], { timeout: 10_000 })).out.trim();
      if (want && st.imageId !== want) { await docker(['rm', '-f', name]); st.state = 'not started'; }
    }
    if (st.state === 'not started') await create();
    else if (st.state === 'stopped') {
      const r = await docker(['start', name]);
      if (r.code !== 0) throw new Error('Docker não conseguiu ligar o computador: ' + r.err.trim().slice(-300));
    }
    clearTimeout(idle.get(name));
    idle.set(name, setTimeout(() => docker(['stop', '-t', '5', name]), (settings.idleStopMinutes || 10) * 60_000));
  }
  const hostPort = async port => /:(\d+)\s*$/m.exec((await docker(['port', name, String(port)])).out)?.[1];

  return {
    kind: 'docker',
    hostname: hostnameOf(agent),
    async exec(command) {
      await ensure();
      const r = await docker(['exec', '-w', '/work', name, 'bash', '-lc', command], { timeout: 300_000 });
      const out = (r.out + r.err);
      return `${out.length > MAX_OUT ? out.slice(0, MAX_OUT) + '\n[… saída cortada]' : out}\n[exit ${r.code}]`;
    },
    async share(port) {
      await ensure();
      if (!PORTS.includes(port)) return `Só as portas ${PORTS.join(', ')} podem ser compartilhadas. Suba o servidor numa delas.`;
      const hp = await hostPort(port);
      return hp ? `http://localhost:${hp}` : 'Porta ainda não publicada. Suba o servidor e tente de novo.';
    },
    /** Endereço da tela da VM (noVNC) nesta máquina. Liga o computador se preciso. */
    async screen() {
      await ensure();
      const hp = await hostPort(VNC_PORT);
      if (!hp) return null;
      for (let i = 0; i < 30; i++) {
        try { if ((await fetch(`http://127.0.0.1:${hp}/vnc.html`, { signal: AbortSignal.timeout(1000) })).ok) return { port: +hp }; } catch {}
        await new Promise(r => setTimeout(r, 300));
      }
      return null;
    },
    async writeFile(fileName, bytes) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(new URL(`uploads/${fileName}`, dir), bytes);
    },
    status: async () => (await inspect()).state
  };
}

/**
 * Transcreve um áudio que está em data/ com o Whisper local (imagem do agente). Nada sai da máquina.
 * O modelo fica no volume ripper-whisper: só o primeiro uso baixa (~150 MB do "base": ~3s por áudio curto, medido em 05/10/2026).
 * ponytail: um contêiner por áudio (~3–6s de partida); servidor Whisper residente se o volume crescer.
 */
export async function transcribeAudio(rel, { model = 'base' } = {}) {
  const host = fileURLToPath(new URL('.', dataUrl(rel)));
  const file = rel.split('/').pop();
  const r = await docker(['run', '--rm', '-v', `${host}:/in:ro`, '-v', 'ripper-whisper:/root/.cache',
    IMAGE, 'python3', '/opt/ripper/transcribe.py', `/in/${file}`, model], { timeout: 600_000 });
  if (r.code !== 0) throw new Error(/No module named|can't open file/.test(r.err) ? 'A imagem dos agentes está desatualizada: reconstrua em Configurações → Computador.' : `Não consegui transcrever: ${r.err.trim().split('\n').at(-1) || 'erro'}`);
  return r.out.trim();
}
