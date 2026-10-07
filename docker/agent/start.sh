#!/bin/sh
# Sobe a tela virtual com o Chromium em tela cheia e o noVNC (tela pela web na porta 6080).
# Sem gerenciador de janelas: nada de papel de parede, barra de tarefas ou janelas de erro.
# Container parado por ociosidade deixa o lock do display; sem limpar, o Xvfb não sobe na volta.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 "$SCREEN_SIZE" -nolisten tcp >/tmp/xvfb.log 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10; do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.3; done
W=$(echo "$SCREEN_SIZE" | cut -dx -f1); H=$(echo "$SCREEN_SIZE" | cut -dx -f2)
# O navegador do agente (lib/browser.mjs) se conecta a este mesmo Chromium pela porta 9222.
# Se a janela for fechada pela tela, ela volta sozinha. Perfil em /work: os logins sobrevivem à recriação do contêiner;
# o lock deixado pelo contêiner anterior (outro hostname) travaria o perfil, então sai antes de abrir.
mkdir -p /work/.ripper/chromium && rm -f /work/.ripper/chromium/Singleton*
( while true; do
    chromium --no-sandbox --disable-dev-shm-usage --lang=pt-BR --no-first-run --no-default-browser-check \
      --test-type --disable-features=Translate --password-store=basic --user-data-dir=/work/.ripper/chromium \
      --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
      --window-position=0,0 --window-size="$W,$H" about:blank >/tmp/chromium.log 2>&1
    sleep 1
  done ) &
# Sem senha, mas só acessível pela porta publicada em 127.0.0.1 da sua máquina.
x11vnc -display :99 -forever -shared -nopw -quiet -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
exec sleep infinity
