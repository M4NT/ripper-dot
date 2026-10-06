#!/usr/bin/env node
// Ripper como serviço: sobe com o computador e volta sozinho se cair.
//   node scripts/service.mjs install | uninstall | status | run
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
  let delay = 0;
  const start = () => {
    const t0 = Date.now();
    const child = spawn(node, ['server.mjs'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    child.on('exit', code => {
      if (code === 0) process.exit(0); // saída limpa = desligado de propósito
      delay = nextDelay(delay, Date.now() - t0);
      console.error(`[vigia] servidor caiu (código ${code}); reiniciando em ${delay / 1000}s`);
      setTimeout(start, delay);
    });
    for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => { child.kill(s); process.exit(0); });
  };
  start();
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
  ({ install, uninstall, status, run }[cmd] || (() => { console.log('uso: node scripts/service.mjs install|uninstall|status|run'); process.exit(1); }))();
}
