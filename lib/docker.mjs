// Computador gratuito: um contêiner Docker por agente e pasta de trabalho, a partir da imagem de referência do Ripper
// (Chromium + tela virtual + noVNC já instalados, então criar a VM leva segundos).
// Todos os contêineres ficam na rede "ripper-net": cada agente é alcançável pelo nome (ex.: http://donald:3000)
// e todos compartilham /shared para trocar arquivos.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataUrl } from './store.mjs';
import { PROJECT_MOUNT, workspaceFor, hiddenDataPath } from './workspace.mjs';
import {
  DEFAULT_GEOMETRY,
  TYPE_DELAY_MS,
  TYPE_MAX,
  USER_CONTROL_MSG,
  assertInGeometry,
  isUserScreenControl,
  parseDisplayGeometry,
  parseKeys,
  scrollPlan,
  displayQueueKey,
  serializeCall,
  splitTypeText,
  typeTimeoutMs,
  withTypeIdempotency
} from './computer-input.mjs';

export const IMAGE = 'ripper-agent:6';
const LEGACY_IMAGES = new Set(['', 'node:22-bookworm', 'ripper-agent:1', 'ripper-agent:2', 'ripper-agent:3', 'ripper-agent:4', 'ripper-agent:5']);
const NETWORK = 'ripper-net';
const PORTS = [3000, 5173, 8000, 8080];        // portas que o agente pode compartilhar
const VNC_PORT = 6080;                         // tela da VM pela web (noVNC)
const MAX_OUT = 20_000;
const idle = new Map();
// Um "ligar/criar" por contêiner por vez: o turno do agente e a tela ao vivo pediam juntos e o 2º falhava com "nome já em uso".
const ensuring = new Map();
let building = null;
// Último contêiner usado por agente: tela ao vivo e status (sem pasta definida) olham para ele.
const lastUsed = new Map();

/** Tela virtual da imagem do agente (Xvfb). Mouse/teclado do xdotool usam o mesmo display. */
export const AGENT_DISPLAY = ':99';
const SCREEN_MAX = 4096;
const BUTTONS = { left: 1, middle: 2, right: 3 };

/** Imagem sem xdotool: outro PR instala o pacote; aqui só o erro claro. */
export const XDOTOOL_MISSING = 'xdotool não está instalado nesta imagem do agente. Reconstrua o computador em Configurações → Computador (a imagem precisa incluir xdotool) para usar mouse e teclado.';

export function xdotoolPresent({ code, out } = {}) {
  return code === 0 && /\bxdotool\b/.test(String(out || ''));
}

export function xdotoolUnavailable({ code, err, out } = {}) {
  const text = `${err || ''}\n${out || ''}`;
  return code === 127 || /xdotool: not found|executable file not found in \$PATH/i.test(text);
}

function coord(n, name) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 0 || v > SCREEN_MAX) throw new Error(`${name} deve ser um número entre 0 e ${SCREEN_MAX}.`);
  return v;
}

/** argv do xdotool (sem shell). Texto de type vai em stdin (`--file -`), nunca em argv. */
export function xdoCommand(kind, input = {}, { geometry } = {}) {
  if (kind === 'move' || kind === 'click') {
    const { x, y } = assertInGeometry(coord(input.x, 'x'), coord(input.y, 'y'), geometry || DEFAULT_GEOMETRY);
    if (kind === 'move') return { argv: ['mousemove', '--sync', String(x), String(y)] };
    const button = BUTTONS[input.button || 'left'];
    if (!button) throw new Error('button deve ser left, middle ou right.');
    const count = input.count == null ? 1 : Math.round(Number(input.count));
    if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('count deve ser 1, 2 ou 3.');
    const args = ['mousemove', '--sync', String(x), String(y), 'click'];
    if (count > 1) args.push('--repeat', String(count));
    args.push(String(button));
    return { argv: args };
  }
  if (kind === 'type') {
    const text = String(input.text ?? '');
    if (!text) throw new Error('text não pode ser vazio.');
    if (text.length > TYPE_MAX) throw new Error(`text é longo demais (máx. ${TYPE_MAX}). Divida em partes.`);
    return { argv: ['type', '--clearmodifiers', '--delay', String(TYPE_DELAY_MS), '--file', '-'], stdin: text };
  }
  if (kind === 'key') {
    const keys = parseKeys(input.keys ?? input.key);
    return { argv: ['key', '--clearmodifiers', '--', ...keys.map(k => k.xdo)] };
  }
  if (kind === 'scroll') {
    const y = scrollPlan(input.dy ?? (input.dx ? 0 : 3), 'dy');
    const x = input.dx ? scrollPlan(input.dx, 'dx') : null;
    if (!y && !x) throw new Error('Informe dy (positivo desce) ou dx.');
    const args = [];
    const notes = [];
    if (y) {
      args.push('click', '--repeat', String(y.n), y.button);
      if (y.clipped) notes.push(`rolagem dy limitada a ${y.n} (pediu ${y.asked})`);
    }
    if (x) {
      args.push('click', '--repeat', String(x.n), x.button);
      if (x.clipped) notes.push(`rolagem dx limitada a ${x.n} (pediu ${x.asked})`);
    }
    return { argv: args, note: notes.join('; ') };
  }
  throw new Error(`ação desconhecida: ${kind}`);
}

/** timeout no contêiner mata o xdotool (matar só o cliente docker deixaria a digitação rodando). */
export function xdoSpec(kind, input = {}, { geometry, wrapTimeout = true } = {}) {
  const inner = xdoCommand(kind, input, { geometry });
  const timeoutMs = kind === 'type' ? typeTimeoutMs((input.text || '').length) : 15_000;
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
  const argv = wrapTimeout
    ? ['timeout', '--kill-after=2', `${secs}s`, 'xdotool', ...inner.argv]
    : inner.argv;
  return { argv, stdin: inner.stdin, timeoutMs: timeoutMs + 5_000, note: inner.note };
}

export async function runXdo(execXdotool, kind, input, { probe, geometry } = {}) {
  if (probe) {
    const p = await probe();
    if (!xdotoolPresent(p)) throw new Error(XDOTOOL_MISSING);
  }
  const spec = xdoSpec(kind, input, { geometry });
  const r = await execXdotool(spec);
  if (xdotoolUnavailable(r)) throw new Error(XDOTOOL_MISSING);
  if (r.code === 124) throw new Error('A ação na tela estourou o tempo e foi interrompida (xdotool encerrado). Não repita o mesmo texto agora: parte pode ter sido digitada.');
  if (r.code !== 0) throw new Error('Não consegui controlar o mouse/teclado da VM: ' + (r.err || r.out || '').trim().slice(-200));
  const ok = (r.out || '').trim() || 'ok';
  return spec.note ? `${ok} (${spec.note})` : ok;
}

function docker(args, { timeout = 60_000, input, cap = MAX_OUT * 2 } = {}) {
  return new Promise(resolve => {
    const p = spawn('docker', args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', d => { if (out.length < cap) out += d; });
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

/** Tag legada mais nova entre as locais quando falta a atual (LEGACY_IMAGES vai da mais velha à mais nova). */
export function pickOutdated(tags, image = IMAGE) {
  if (tags.includes(image)) return null;
  return [...LEGACY_IMAGES].filter(t => t.startsWith('ripper-agent:') && tags.includes(t)).at(-1) || null;
}

/** Imagem dos agentes desatualizada? Devolve a tag antiga presente (ex.: ripper-agent:2) ou null (em dia, nunca construída ou sem Docker). */
export async function outdatedImage() {
  const r = await docker(['image', 'ls', 'ripper-agent', '--format', '{{.Repository}}:{{.Tag}}'], { timeout: 10_000 });
  return r.code === 0 ? pickOutdated(r.out.split(/\r?\n/)) : null;
}

async function ensureNetwork() {
  if ((await docker(['network', 'inspect', NETWORK], { timeout: 10_000 })).code !== 0) await docker(['network', 'create', NETWORK]);
}

const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agente';
/** Chave da pasta de trabalho montada ('' = sem pasta: contêiner padrão do agente). */
export const wsKeyOf = ws => ws?.kind === 'folder' ? `${ws.path}${ws.readOnly ? ':ro' : ''}` : '';
const wsHash = key => key ? createHash('sha256').update(key).digest('hex').slice(0, 8) : '';
/** Um contêiner por (agente, pasta). Sem pasta mantém o nome antigo, então contêineres existentes continuam valendo. */
export const containerNameOf = (agentId, key = '') => `ripper-${String(agentId).slice(0, 12)}${key ? `-${wsHash(key)}` : ''}`;
export const hostnameOf = (agent, key = '') => `${slug(agent.name)}${key ? `-${wsHash(key)}` : ''}`;

/**
 * ws: pasta de trabalho da conversa ({ kind: 'folder', path, readOnly } | { kind: 'repo', repo, auth? }), null = sem pasta,
 * undefined = tanto faz (tela ao vivo, status): usa o contêiner como estiver, sem recriar por causa da pasta.
 */
export function dockerComputer(agent, settings, ws) {
  const wsKey = wsKeyOf(ws);
  // ws undefined (tela ao vivo, status): o contêiner que o agente usou por último (ou o padrão).
  const name = ws === undefined ? lastUsed.get(agent.id) || containerNameOf(agent.id) : containerNameOf(agent.id, wsKey);
  const host = ws === undefined && name !== containerNameOf(agent.id) ? null : hostnameOf(agent, wsKey);
  const image = LEGACY_IMAGES.has(settings.dockerImage || '') ? IMAGE : settings.dockerImage;
  const dir = dataUrl(`sandbox/${agent.id}/`);
  const shared = dataUrl('shared/');
  const market = dataUrl('skills-market/');
  mkdirSync(new URL('uploads/', dir), { recursive: true });
  mkdirSync(shared, { recursive: true });
  mkdirSync(market, { recursive: true });

  async function inspect() {
    const r = await docker(['inspect', '-f', '{{.State.Running}}|{{.Image}}|{{index .Config.Labels "ripper.ws"}}', name], { timeout: 10_000 });
    if (r.code !== 0) return { state: 'not started' };
    const [running, imageId, wsLabel] = r.out.trim().split('|');
    return { state: running === 'true' ? 'running' : 'stopped', imageId, wsLabel: wsLabel === '<no value>' ? '' : wsLabel || '' };
  }
  async function create() {
    await ensureImage(image);
    await ensureNetwork();
    const r = await docker(['run', '-d', '--name', name, '--label', 'ripper=1', '--label', `ripper.agent=${agent.id}`,
      '--hostname', host, '--network', NETWORK, '--network-alias', host,
      '--label', `ripper.ws=${wsKey}`, ...wsMount,
      '-v', `${fileURLToPath(dir)}:/work`, '-v', `${fileURLToPath(shared)}:/shared`, '-v', `${fileURLToPath(market)}:/skills:ro`, '-w', '/work',
      '--memory', settings.dockerMemory || '2g', '--cpus', String(settings.dockerCpus || 2), '--shm-size', '512m',
      ...[...PORTS, VNC_PORT].flatMap(p => ['-p', `127.0.0.1::${p}`]), image], { timeout: 300_000 });
    if (r.code !== 0) throw new Error('Docker não conseguiu criar o computador: ' + (r.err || r.out).trim().slice(-300));
  }
  // Uma subida por vez por contêiner; quem chega depois espera e confere de novo (a pasta pedida pode ser outra).
  async function ensure() {
    while (ensuring.has(name)) await ensuring.get(name).catch(() => {});
    const run = doEnsure().finally(() => ensuring.delete(name));
    ensuring.set(name, run);
    return run;
  }
  async function doEnsure() {
    const st = await inspect();
    // Contêiner de uma versão antiga da imagem (ou de outra imagem): recria. Os arquivos ficam em /work e /shared.
    if (st.state !== 'not started') {
      const want = (await docker(['image', 'inspect', '-f', '{{.Id}}', image], { timeout: 10_000 })).out.trim();
      // Imagem nova ou outra pasta de trabalho (o volume é fixo na criação): recria; /work e /shared continuam.
      if ((want && st.imageId !== want && host) || (ws !== undefined && st.wsLabel !== wsKey)) { await docker(['rm', '-f', name]); st.state = 'not started'; }
    }
    if (st.state === 'not started') {
      if (!host) throw new Error('O computador desta pasta foi desligado; abra a conversa para religar.');
      await create();
    }
    else if (st.state === 'stopped') {
      const r = await docker(['start', name]);
      if (r.code !== 0) throw new Error('Docker não conseguiu ligar o computador: ' + r.err.trim().slice(-300));
    }
    lastUsed.set(agent.id, name);
    clearTimeout(idle.get(name));
    idle.set(name, setTimeout(() => docker(['stop', '-t', '5', name]), (settings.idleStopMinutes || 10) * 60_000));
  }
  // Pasta que contém os dados do Ripper (o próprio código do Ripper): a subpasta de dados some atrás de um tmpfs vazio.
  const hidden = ws?.kind === 'folder' ? hiddenDataPath(ws.path) : null;
  const wsMount = ws?.kind === 'folder' ? ['-v', `${ws.path}:${PROJECT_MOUNT}${ws.readOnly ? ':ro' : ''}`, ...(hidden ? ['--mount', `type=tmpfs,destination=${PROJECT_MOUNT}/${hidden}`] : [])] : [];
  const cwd = workspaceFor(ws, 'docker').cwd || '/work';
  let cloned = false;
  async function cloneOnce() {
    if (cloned) return;
    const d = cwd;
    const r = await docker(['exec', '-w', '/work', name, 'bash', '-lc', `[ -d ${d}/.git ] || (mkdir -p /work/repos && git ${ws.auth || ''} clone -q https://github.com/${ws.repo}.git ${d})`], { timeout: 300_000 });
    if (r.code !== 0) throw new Error(`Não consegui clonar ${ws.repo}: ${(r.err || r.out).replace(/basic [A-Za-z0-9+/=]{20,}/g, 'basic ••••').trim().slice(-300)}`);
    cloned = true;
  }
  const hostPort = async port => /:(\d+)\s*$/m.exec((await docker(['port', name, String(port)])).out)?.[1];
  let xdoOk = false;
  let geo;
  async function displayGeometry() {
    if (geo) return geo;
    const r = await docker(['exec', '-e', `DISPLAY=${AGENT_DISPLAY}`, name, 'xdotool', 'getdisplaygeometry'], { timeout: 10_000 });
    geo = parseDisplayGeometry(r.out) || DEFAULT_GEOMETRY;
    return geo;
  }
  async function xdoUnlocked(kind, input, { markTyped } = {}) {
    if (isUserScreenControl(agent.id)) throw new Error(USER_CONTROL_MSG);
    await ensure();
    const probe = xdoOk ? undefined : async () => {
      const p = await docker(['exec', name, 'sh', '-c', 'command -v xdotool'], { timeout: 10_000 });
      if (xdotoolPresent(p)) xdoOk = true;
      return p;
    };
    const geometry = (kind === 'click' || kind === 'move') ? await displayGeometry() : undefined;
    if (probe) {
      const p = await probe();
      if (!xdotoolPresent(p)) throw new Error(XDOTOOL_MISSING);
    }
    markTyped?.();
    return runXdo(
      spec => docker(
        ['exec', ...(spec.stdin != null ? ['-i'] : []), '-e', `DISPLAY=${AGENT_DISPLAY}`, name, ...spec.argv],
        { timeout: spec.timeoutMs, input: spec.stdin }
      ),
      kind,
      input,
      { geometry }
    );
  }
  async function xdo(kind, input) {
    return serializeCall(displayQueueKey(agent.id), () => xdoUnlocked(kind, input));
  }
  async function typeText(a) {
    const text = String(a?.text ?? '');
    if (!text) throw new Error('text não pode ser vazio.');
    if (text.length > TYPE_MAX) throw new Error(`text é longo demais (máx. ${TYPE_MAX}). Divida em partes.`);
    return withTypeIdempotency(name, a.requestId, ({ markTyped }) => serializeCall(displayQueueKey(agent.id), async () => {
      const chunks = splitTypeText(text);
      let last = 'ok';
      let started = false;
      for (const chunk of chunks) {
        last = await xdoUnlocked('type', { text: chunk }, { markTyped: started ? undefined : markTyped });
        started = true;
      }
      return last;
    }));
  }

  return {
    kind: 'docker',
    hostname: host || hostnameOf(agent),
    // opts.input: stdin do docker exec -i (ex.: token HMAC do navegador, fora do ps).
    async exec(command, opts) {
      await ensure();
      if (ws?.kind === 'repo') await cloneOnce();
      const input = opts && opts.input != null ? String(opts.input) : undefined;
      const args = ['exec'];
      if (input != null) args.push('-i');
      args.push('-w', cwd, name, 'bash', '-lc', command);
      const r = await docker(args, { timeout: 300_000, input });
      const out = (r.out + r.err);
      return `${out.length > MAX_OUT ? out.slice(0, MAX_OUT) + '\n[… saída cortada]' : out}\n[exit ${r.code}]`;
    },
    /** Foto da tela da VM (display :99) em JPEG base64 — o modelo vê a imagem, não o texto. */
    /** recorte: área opcional no formato LxA+X+Y (ex.: 1200x480+80+268). Só números: vai para o shell. */
    async screenshot({ recorte } = {}) {
      await ensure();
      const crop = recorte && /^[0-9]+x[0-9]+[+][0-9]+[+][0-9]+$/.test(recorte) ? `-crop ${recorte} +repage ` : '';
      const r = await docker(['exec', name, 'sh', '-c', `import -display :99 -window root ${crop}-resize 1280x -quality 60 jpeg:- | base64 -w0`], { timeout: 30_000, cap: 2_000_000 });
      if (r.code !== 0 || !r.out.trim()) throw new Error('Não consegui tirar foto da tela da VM: ' + (r.err || 'sem saída').trim().slice(-200));
      return r.out.trim();
    },
    async click(a) { return xdo('click', a); },
    async type(a) { return typeText(a); },
    async key(a) { return xdo('key', a); },
    async move(a) { return xdo('move', a); },
    async scroll(a) { return xdo('scroll', a); },
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
