# Imagem de referência dos agentes do Ripper: tudo pré-instalado, então criar a VM de um agente leva segundos.
# Linux + Node 22 + Python 3 + Chromium + tela virtual (Xvfb) + acesso pela web (noVNC).
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_SIZE=1280x800x24 \
    LANG=pt_BR.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-color-emoji \
      xvfb x11vnc fluxbox novnc websockify \
      procps curl ca-certificates git python3-pip jq locales \
  && sed -i 's/# pt_BR.UTF-8/pt_BR.UTF-8/' /etc/locale.gen && locale-gen \
  && rm -rf /var/lib/apt/lists/*

# Controle do navegador pelo agente (a mesma janela que você vê e controla pela tela).
RUN mkdir -p /opt/ripper-browser && cd /opt/ripper-browser \
  && npm init -y >/dev/null && npm i -s puppeteer-core@23 >/dev/null

COPY start.sh /usr/local/bin/ripper-start
RUN chmod +x /usr/local/bin/ripper-start

WORKDIR /work
EXPOSE 6080
CMD ["ripper-start"]
