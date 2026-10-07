#!/usr/bin/env node
// Ripper como serviço: sobe com o computador e volta sozinho se cair.
//   node scripts/service.mjs install | uninstall | status | run | restart
// `restart` (depois de atualizar o código): o servidor espera os turnos em andamento e o vigia sobe a versão nova.
// `run` é o vigia: reinicia o servidor quando ele sai com erro (espera crescente até 1 min).
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'Ripper';
const node = process.execPath;
const self = join(ROOT, 'scripts', 'service.mjs');
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe', windowsHide: true }).toString();

export function nextDelay(prev, uptimeMs) {
  if (uptimeMs > 5 * 60_000) return 1000; // ficou de pé um tempo: recomeça a espera
  return Math.min(Math.max(prev * 2, 1000), 60_000);
}

function run() {
  let delay = 0, child;
  const start = () => {
    const t0 = Date.now();
    child = spawn(node, ['server.mjs'], { cwd: ROOT, stdio: 'inherit', windowsHide: true, env: { ...process.env, RIPPER_SUPERVISED: '1' } });
    child.on('exit', code => {
      if (code === 0) process.exit(0); // saída limpa = desligado de propósito
      if (code === 75) { delay = 0; console.log('[vigia] reiniciando para atualizar'); return start(); } // RESTART_EXIT_CODE
      delay = nextDelay(delay, Date.now() - t0);
      console.error(`[vigia] servidor caiu (código ${code}); reiniciando em ${delay / 1000}s`);
      setTimeout(start, delay);
    });
  };
  // uma vez só, sempre no filho atual (antes, cada reinício somava um handler que matava o filho antigo)
  for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => { child.kill(s); process.exit(0); });
  start();
}

const installed = () => {
  try {
    if (process.platform === 'win32') { sh('schtasks', ['/Query', '/TN', NAME]); return true; }
    if (process.platform === 'darwin') return existsSync(unitPath());
    sh('systemctl', ['--user', 'cat', 'ripper.service']); return true;
  } catch { return false; }
};

function restart() {
  // Sem o vigia do serviço ninguém sobe o servidor de novo: reiniciar aqui só o derrubaria.
  if (!installed()) {
    console.log('O serviço não está instalado, então o Ripper não voltaria sozinho. Pare o servidor (Ctrl+C no terminal dele) e rode "npm start" de novo, ou instale o serviço: node scripts/service.mjs install');
    process.exit(1);
  }
  const dir = process.env.RIPPER_DATA ? resolve(process.env.RIPPER_DATA) : join(ROOT, 'data');
  writeFileSync(join(dir, 'restart.request'), String(Date.now()));
  console.log('Pedido enviado: o Ripper reinicia assim que os turnos em andamento terminarem (até 2 min).');
}

const unitPath = () => process.platform === 'darwin'
  ? join(homedir(), 'Library/LaunchAgents/com.ripper.server.plist')
  : join(homedir(), '.config/systemd/user/ripper.service');

function install() {
  if (process.platform === 'win32') {
    // tarefa ao entrar no Windows; o vigia cuida das quedas
    sh('schtasks', ['/Create', '/F', '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TN', NAME, '/TR', `"${node}" "${self}" run`]);
    sh('schtasks', ['/Run', '/TN', NAME]);
  } else if (process.platform === 'darwin') {
    mkdirSync(dirname(unitPath()), { recursive: true });
    writeFileSync(unitPath(), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.ripper.server</string>
<key>ProgramArguments</key><array><string>${node}</string><string>${self}</string><string>run</string></array>
<key>WorkingDirectory</key><string>${ROOT}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardErrorPath</key><string>${join(homedir(), 'Library/Logs/ripper.log')}</string>
</dict></plist>
`);
    sh('launchctl', ['load', '-w', unitPath()]);
  } else {
    mkdirSync(dirname(unitPath()), { recursive: true });
    writeFileSync(unitPath(), `[Unit]
Description=Ripper
After=network-online.target

[Service]
WorkingDirectory=${ROOT}
ExecStart=${node} ${self} run
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`);
    sh('systemctl', ['--user', 'daemon-reload']);
    sh('systemctl', ['--user', 'enable', '--now', 'ripper.service']);
    console.log('Dica: `loginctl enable-linger` faz subir mesmo antes de você entrar.');
  }
  console.log('Ripper instalado como serviço: sobe com o computador e volta sozinho se cair.');
}

function uninstall() {
  try {
    if (process.platform === 'win32') { sh('schtasks', ['/End', '/TN', NAME]); sh('schtasks', ['/Delete', '/F', '/TN', NAME]); }
    else if (process.platform === 'darwin') { sh('launchctl', ['unload', '-w', unitPath()]); rmSync(unitPath()); }
    else { sh('systemctl', ['--user', 'disable', '--now', 'ripper.service']); rmSync(unitPath()); }
    console.log('Serviço removido.');
  } catch { console.log('Serviço não estava instalado.'); }
}

function status() {
  try {
    if (process.platform === 'win32') console.log(sh('schtasks', ['/Query', '/TN', NAME]));
    else if (process.platform === 'darwin') console.log(existsSync(unitPath()) ? sh('launchctl', ['list', 'com.ripper.server']) : 'não instalado');
    else console.log(sh('systemctl', ['--user', 'status', 'ripper.service', '--no-pager']));
  } catch { console.log('não instalado'); }
}

if (process.argv[1] && resolve(process.argv[1]) === self) {
  const cmd = process.argv[2];
  ({ install, uninstall, status, run, restart }[cmd] || (() => { console.log('uso: node scripts/service.mjs install|uninstall|status|run|restart'); process.exit(1); }))();
}
