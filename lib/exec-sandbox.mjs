/**
 * Execução de shell em contêiner Docker efêmero (docker run --rm).
 * Isola comandos do host quando settings.sandbox.enabled (ou RIPPER_SANDBOX_*).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dockerAvailable } from './docker.mjs';
import { dataUrl } from './store.mjs';

const MAX_OUT = 100_000;
const DEFAULT = {
  enabled: false,
  image: 'node:22-alpine',
  network: 'none',
  memory: '512m',
  cpus: '1',
  timeoutSeconds: 300
};

function envBool(v) {
  if (v == null || v === '') return undefined;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return undefined;
}

/** Config efetiva: settings.sandbox com override por variáveis de ambiente. */
export function resolveSandboxConfig(settings = {}) {
  const fromDb = { ...DEFAULT, ...(settings.sandbox || {}) };
  const enabled = envBool(process.env.RIPPER_SANDBOX_ENABLED);
  const image = process.env.RIPPER_SANDBOX_IMAGE?.trim();
  const network = process.env.RIPPER_SANDBOX_NETWORK?.trim();
  const memory = process.env.RIPPER_SANDBOX_MEMORY?.trim();
  const cpus = process.env.RIPPER_SANDBOX_CPUS?.trim();
  const timeoutRaw = process.env.RIPPER_SANDBOX_TIMEOUT_SECONDS?.trim();
  const timeoutSeconds = timeoutRaw ? +timeoutRaw : undefined;
  return {
    enabled: enabled ?? !!fromDb.enabled,
    image: image || fromDb.image || DEFAULT.image,
    network: network === 'bridge' ? 'bridge' : network === 'none' ? 'none' : (fromDb.network === 'bridge' ? 'bridge' : 'none'),
    memory: memory || fromDb.memory || DEFAULT.memory,
    cpus: cpus || fromDb.cpus || DEFAULT.cpus,
    timeoutSeconds: Math.max(5, Math.min(3600, timeoutSeconds || fromDb.timeoutSeconds || DEFAULT.timeoutSeconds))
  };
}

export function sandboxDefaults() {
  return { ...DEFAULT };
}

export function buildDockerRunArgs(config, workDirHost) {
  const net = config.network === 'bridge' ? 'bridge' : 'none';
  return [
    'run', '--rm',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '-v', `${workDirHost}:/work:rw`,
    '-w', '/work',
    '--network', net,
    '--memory', String(config.memory),
    '--cpus', String(config.cpus),
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--init',
    config.image,
    'sh', '-lc'
  ];
}

function defaultDockerSpawn(args, { timeoutMs, input } = {}) {
  return new Promise(resolve => {
    const p = spawn('docker', args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', d => { if (out.length < MAX_OUT * 2) out += d; });
    p.stderr.on('data', d => { if (err.length < MAX_OUT) err += d; });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out: '', err: e.message }); });
    p.on('close', code => { clearTimeout(t); resolve({ code, out, err }); });
    if (input != null) p.stdin.end(input);
    else p.stdin.end();
  });
}

/**
 * Roda comando no sandbox Docker. `dockerRun` injetável para testes.
 * @returns {Promise<string>} saída formatada como computer.exec
 */
export async function execInDockerSandbox(command, workDirUrl, settings, { dockerRun = defaultDockerSpawn, probeDocker = dockerAvailable } = {}) {
  const config = resolveSandboxConfig(settings);
  if (!config.enabled) throw new Error('Sandbox desligado.');
  const version = await probeDocker();
  if (!version) {
    return 'Sandbox Docker está ativo nas configurações, mas o daemon Docker não está disponível nesta máquina. Desative o sandbox em Configurações → Segurança ou instale/inicie o Docker.\n[exit 127]';
  }
  const workDirHost = fileURLToPath(workDirUrl);
  const args = [...buildDockerRunArgs(config, workDirHost), command];
  const timeoutMs = config.timeoutSeconds * 1000;
  const r = await dockerRun(args, { timeoutMs });
  const combined = (r.out + r.err);
  const clipped = combined.length > MAX_OUT ? combined.slice(0, MAX_OUT) + '\n[… saída cortada]' : combined;
  const code = r.code ?? 1;
  return `${clipped}\n[exit ${code}]`;
}

/** Envolve computer.exec quando o sandbox está ligado e o computador roda na máquina host (modo local). */
export function wrapComputerExecSandbox(computer, agent, settings) {
  if (!computer || computer.kind !== 'local') return computer;
  const config = resolveSandboxConfig(settings);
  if (!config.enabled) return computer;
  const workDir = dataUrl(`sandbox/${agent.id}/`);
  return {
    ...computer,
    kind: computer.kind,
    sandbox: true,
    exec(command) {
      return execInDockerSandbox(command, workDir, settings);
    }
  };
}

/** Para API / diagnóstico. */
export async function sandboxStatus(settings) {
  const config = resolveSandboxConfig(settings);
  const docker = await dockerAvailable();
  return {
    enabled: config.enabled,
    dockerAvailable: !!docker,
    dockerVersion: docker || null,
    config: {
      image: config.image,
      network: config.network,
      memory: config.memory,
      cpus: config.cpus,
      timeoutSeconds: config.timeoutSeconds
    },
    ready: !config.enabled || !!docker,
    fallback: config.enabled && !docker
      ? 'Com sandbox ativo e Docker ausente, comandos locais não rodam no host — retornam erro até o Docker subir ou o sandbox ser desligado.'
      : null
  };
}
