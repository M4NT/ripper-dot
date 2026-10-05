# Imagem de referência dos agentes do Ripper: tudo pré-instalado, então criar a VM de um agente leva segundos.
# Linux + Node 22 + Python 3 + Chromium + tela virtual (Xvfb) + acesso pela web (noVNC).
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_SIZE=1280x800x24 \
    LANG=pt_BR.UTF-8 \
    PIP_BREAK_SYSTEM_PACKAGES=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji \
      xvfb x11vnc novnc websockify \
      procps curl ca-certificates git python3-pip jq locales \
  && sed -i 's/# pt_BR.UTF-8/pt_BR.UTF-8/' /etc/locale.gen && locale-gen \
  && rm -rf /var/lib/apt/lists/*

# Documentos e dados prontos: o agente não gasta tempo nem tokens instalando a cada pedido.
# (PIP_BREAK_SYSTEM_PACKAGES acima: sem isso o pip recusava instalar e o erro vazava na resposta.)
RUN pip install --no-cache-dir python-docx openpyxl pandas reportlab xlsxwriter python-pptx pypdf

# Transcrição local de áudio (ditado e áudios do WhatsApp): nada sai da máquina.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir faster-whisper
COPY transcribe.py /opt/ripper/transcribe.py

# Controle do navegador pelo agente (a mesma janela que você vê e controla pela tela).
RUN mkdir -p /opt/ripper-browser && cd /opt/ripper-browser \
  && npm init -y >/dev/null && npm i -s puppeteer-core@23 >/dev/null

# Esconde a aba lateral do noVNC: o Ripper já tem os próprios controles da tela.
RUN echo '#noVNC_control_bar_anchor,#noVNC_status{display:none!important}' >> /usr/share/novnc/app/styles/base.css

# Chromium sem convite de login nem sincronização (é o navegador do agente, não o seu).
RUN mkdir -p /etc/chromium/policies/managed && echo '{"BrowserSignin":0,"SyncDisabled":true,"PromotionalTabsEnabled":false}' > /etc/chromium/policies/managed/ripper.json

COPY start.sh /usr/local/bin/ripper-start
RUN chmod +x /usr/local/bin/ripper-start

WORKDIR /work
EXPOSE 6080
CMD ["ripper-start"]
