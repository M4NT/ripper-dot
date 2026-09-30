#!/bin/sh
# Sobe a tela virtual, o gerenciador de janelas e o noVNC (tela pela web na porta 6080).
# Fundo liso e sem papel de parede (evita a janela de erro do fbsetbg e deixa a tela limpa).
mkdir -p "$HOME/.fluxbox"
cat > "$HOME/.fluxbox/overlay" <<'CFG'
background: flat
background.color: #1f1d1b
CFG
cat > "$HOME/.fluxbox/init" <<'CFG'
session.screen0.rootCommand: fbsetroot -solid #1f1d1b
session.screen0.toolbar.visible: true
session.screen0.toolbar.placement: BottomCenter
session.styleOverlay: ~/.fluxbox/overlay
CFG
Xvfb :99 -screen 0 "$SCREEN_SIZE" -nolisten tcp >/tmp/xvfb.log 2>&1 &
sleep 1
fbsetroot -solid '#1f1d1b' 2>/dev/null
fluxbox >/tmp/fluxbox.log 2>&1 &
# Sem senha, mas só acessível pela porta publicada em 127.0.0.1 da sua máquina.
x11vnc -display :99 -forever -shared -nopw -quiet -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
exec sleep infinity
