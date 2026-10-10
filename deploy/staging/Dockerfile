# Imagem do servidor Ripper só para staging (provedor de teste + seed).
# Não substitui a imagem dos agentes em docker/agent/.
# Sem marcar o processo como produção: o sinal de ambiente é RIPPER_ENV=staging.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server.mjs vite.config.mjs ./
COPY lib ./lib
COPY web ./web
COPY skills ./skills
COPY scripts/staging.mjs ./scripts/staging.mjs
COPY deploy/staging ./deploy/staging

RUN npm run build

ENV RIPPER_ENV=staging \
    RIPPER_STAGING_HOST=0.0.0.0 \
    RIPPER_STAGING_LISTEN=3000 \
    RIPPER_STAGING_DATA=/data \
    RIPPER_STAGING_PROVIDER=stream \
    JULIA_AUTOSTART=0 \
    RIPPER_NO_PREWARM=1

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "scripts/staging.mjs", "serve"]
