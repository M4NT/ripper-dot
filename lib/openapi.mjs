import { FLAG_CATALOG, KNOWN_FLAG_KEYS } from './feature-flags.mjs';

/** OpenAPI 3.0 mínimo — superfície HTTP pública/ops do Ripper (sem codegen). */

const INFO = `
API HTTP do Ripper (agentes, chat SSE, configurações). A UI estática é servida na raiz após \`npm run build\`.

**Autenticação:** com \`RIPPER_TOKEN\` definido, rotas \`/api/*\` exigem \`Authorization: Bearer <token>\` ou cookie \`ripper_token\` (via \`?token=\` na primeira visita). Sem token configurado, a API local fica aberta (apenas desenvolvimento).

**\`/metrics\`:** exige o mesmo Bearer/cookie **ou** scrape público quando \`RIPPER_METRICS_PUBLIC=1\`.

**CORS:** cabeçalhos \`Access-Control-*\` só para origens listadas em \`RIPPER_CORS_ORIGIN\` (vírgula). **CSRF:** mutações em \`/api/*\` com \`Origin\` de host diferente (e fora da allowlist) recebem **403**; requisições sem \`Origin\` não são bloqueadas por essa regra.

**401:** token ausente ou inválido onde exigido.

**429:** limite de taxa opt-in (\`settings.rateLimit\` / env \`RIPPER_RATE_*\`) em rotas pesadas e \`POST /api/chat\`.

**413 / tempo:** corpo acima de \`RIPPER_MAX_BODY_BYTES\` (ou teto de upload em \`POST /api/files\`) → **413**; timeout de requisição via \`RIPPER_HTTP_TIMEOUT_MS\`; SSE em \`POST /api/chat\` usa \`RIPPER_SSE_TIMEOUT_MS\` (0 = sem limite).

**503:** encerramento gracioso (\`/api/*\` recusado com mensagem de shutdown); \`/readyz\` com store indisponível ou \`shutting_down\`; frontend não compilado ao servir estáticos; algumas rotas de computador enquanto sobem.

**X-Request-Id:** cabeçalho \`X-Request-Id\` ecoado em respostas (UUID gerado se o cliente não enviar um id alfanumérico válido).

**Logs:** eventos estruturados \`http.request.start\` / \`http.request.end\` em rotas selecionadas (ver \`settings.logging\`).

**Settings:** \`PUT /api/settings\` validado por schema (\`lib/settings-schema.mjs\`); resposta de erro 400 pode incluir \`details[]\`.

**Provedores:** circuit breaker de provedor de modelo é interno ao chat (logs \`provider.circuit_breaker\`); não há endpoint HTTP dedicado.

Este documento lista só a superfície mínima acordada; outras rotas \`/api/*\` existem no servidor mas não estão descritas aqui.
`.trim();

const errorJson = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string' },
    details: { type: 'array', items: { type: 'object', additionalProperties: true } }
  }
};

const probeSchema = {
  type: 'object',
  required: ['ok', 'version', 'uptimeSeconds'],
  properties: {
    ok: { type: 'boolean' },
    version: { type: 'string', description: 'Versão do pacote Ripper' },
    uptimeSeconds: { type: 'integer', minimum: 0 }
  }
};

const bearerAuth = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'RIPPER_TOKEN',
  description: 'Segredo em `RIPPER_TOKEN`. Também aceito via cookie `ripper_token`.'
};

const unauthorized = {
  description: 'Não autorizado — Bearer/cookie ausente ou inválido.',
  content: { 'application/json': { schema: errorJson } }
};

const forbiddenOrigin = {
  description: 'Origem não permitida (CSRF) — `Origin` cross-site em mutação.',
  content: { 'application/json': { schema: errorJson } }
};

const rateLimited = {
  description: 'Limite de taxa excedido (opt-in). Cabeçalho `Retry-After` em segundos.',
  content: { 'application/json': { schema: errorJson } }
};

const serviceUnavailable = {
  description: 'Serviço indisponível (shutdown, readiness, frontend ou dependência).',
  content: { 'application/json': { schema: errorJson } }
};

const shutdownUnavailable = {
  description: 'Servidor em encerramento gracioso — novas chamadas `/api/*` recusadas.',
  content: { 'application/json': { schema: errorJson } }
};

/** @param {{ port?: number, host?: string, version?: string }} [opts] */
export function buildOpenApiDocument(opts = {}) {
  const port = opts.port ?? 3000;
  const host = opts.host ?? '127.0.0.1';
  const version = opts.version ?? '0.1.0';
  const serverUrl = host === '0.0.0.0' ? `http://localhost:${port}` : `http://${host}:${port}`;

  const flagProperties = Object.fromEntries(
    KNOWN_FLAG_KEYS.map(k => [k, { type: 'boolean', description: FLAG_CATALOG.find(f => f.key === k)?.label }])
  );

  return {
    openapi: '3.0.3',
    info: {
      title: 'Ripper HTTP API',
      version,
      description: INFO
    },
    servers: [{ url: serverUrl, description: 'Instância local (PORT/HOST do processo)' }],
    tags: [
      { name: 'ops', description: 'Sondas, métricas e descoberta' },
      { name: 'api', description: 'API autenticada sob `/api`' }
    ],
    paths: {
      '/healthz': {
        get: {
          tags: ['ops'],
          summary: 'Liveness',
          description: 'Processo HTTP no ar; não exige Bearer.',
          operationId: 'getHealthz',
          responses: {
            200: {
              description: 'Servidor vivo',
              content: { 'application/json': { schema: probeSchema } }
            }
          }
        }
      },
      '/readyz': {
        get: {
          tags: ['ops'],
          summary: 'Readiness',
          description: 'Valida store de dados e ausência de shutdown; não exige Bearer.',
          operationId: 'getReadyz',
          responses: {
            200: {
              description: 'Pronto',
              content: { 'application/json': { schema: probeSchema } }
            },
            503: {
              description: 'Não pronto (`reason`: ex. `shutting_down`, store indisponível)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok', 'reason', 'version', 'uptimeSeconds'],
                    properties: {
                      ok: { type: 'boolean', const: false },
                      reason: { type: 'string' },
                      version: { type: 'string' },
                      uptimeSeconds: { type: 'integer' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/metrics': {
        get: {
          tags: ['ops'],
          summary: 'Métricas Prometheus',
          description:
            'Texto `text/plain; version=0.0.4` (ex.: `ripper_http_requests_total`, `ripper_process_uptime_seconds`). Com `RIPPER_METRICS_PUBLIC=1`, scrape sem autenticação.',
          operationId: 'getMetrics',
          security: [{ bearerAuth: [] }, {}],
          responses: {
            200: {
              description: 'Exposição Prometheus',
              content: { 'text/plain': { schema: { type: 'string' } } }
            },
            401: unauthorized
          }
        }
      },
      '/openapi.json': {
        get: {
          tags: ['ops'],
          summary: 'Documento OpenAPI',
          operationId: 'getOpenApi',
          responses: {
            200: {
              description: 'Este documento (JSON)',
              content: { 'application/json': { schema: { type: 'object' } } }
            }
          }
        }
      },
      '/docs': {
        get: {
          tags: ['ops'],
          summary: 'Página mínima de documentação',
          description: 'HTML estático com link para `/openapi.json` (sem Swagger UI).',
          operationId: 'getDocs',
          responses: {
            200: { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } }
          }
        }
      },
      '/api/health': {
        get: {
          tags: ['api'],
          summary: 'Saúde autenticada',
          operationId: 'getApiHealth',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'OK (mesmo payload de probe: version, uptimeSeconds)',
              content: { 'application/json': { schema: probeSchema } }
            },
            401: unauthorized,
            503: shutdownUnavailable
          }
        }
      },
      '/api/flags': {
        get: {
          tags: ['api'],
          summary: 'Feature flags efetivas',
          description: `Flags booleanas conhecidas: ${KNOWN_FLAG_KEYS.join(', ')}. Chaves custom só com \`allowCustom\` em settings.`,
          operationId: 'getFlags',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Mapa de flags (sem `allowCustom`)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['flags'],
                    properties: {
                      flags: {
                        type: 'object',
                        additionalProperties: { type: 'boolean' },
                        properties: flagProperties
                      }
                    }
                  }
                }
              }
            },
            401: unauthorized,
            503: shutdownUnavailable
          }
        }
      },
      '/api/settings': {
        get: {
          tags: ['api'],
          summary: 'Lê configurações (segredos redigidos)',
          operationId: 'getSettings',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Settings + meta (schema, flags catalog, etc.)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      settings: { type: 'object', additionalProperties: true },
                      meta: { type: 'object', additionalProperties: true }
                    }
                  }
                }
              }
            },
            401: unauthorized,
            503: shutdownUnavailable
          }
        },
        put: {
          tags: ['api'],
          summary: 'Atualiza configurações',
          description: 'Patch validado por schema; campos desconhecidos ou tipos inválidos → 400 com `details`.',
          operationId: 'putSettings',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } }
          },
          responses: {
            200: { description: 'Settings atualizados (redigidos)', content: { 'application/json': { schema: { type: 'object' } } } },
            400: { description: 'Patch inválido', content: { 'application/json': { schema: errorJson } } },
            401: unauthorized,
            403: forbiddenOrigin,
            413: { description: 'Corpo excede limite HTTP configurado', content: { 'application/json': { schema: errorJson } } },
            429: rateLimited,
            503: shutdownUnavailable
          }
        }
      },
      '/api/chat': {
        post: {
          tags: ['api'],
          summary: 'Envia mensagem e recebe resposta em SSE',
          description:
            'Resposta `text/event-stream`: eventos JSON em linhas `data: …`, com `: ping` periódico. Falhas de provedor podem acionar circuit breaker interno (sem endpoint HTTP). Corpo JSON: `text`, `chatId` ou `agentId`, opcionalmente `model`, `effort`, `fileIds`, `mcpSession`.',
          operationId: 'postChat',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    chatId: { type: 'string' },
                    agentId: { type: 'string' },
                    agentIds: { type: 'array', items: { type: 'string' } },
                    projectId: { type: 'string' },
                    model: { type: 'string' },
                    effort: { type: 'string' },
                    fileIds: { type: 'array', items: { type: 'string' } },
                    mcpSession: { type: 'object', additionalProperties: true }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Stream SSE iniciado',
              content: { 'text/event-stream': { schema: { type: 'string', description: 'Eventos SSE (`data: {json}`)' } } }
            },
            401: unauthorized,
            403: forbiddenOrigin,
            413: { description: 'Corpo excede limite HTTP configurado', content: { 'application/json': { schema: errorJson } } },
            409: { description: 'Conversa já em streaming', content: { 'application/json': { schema: errorJson } } },
            429: { description: 'Cota de envio ou rate limit', content: { 'application/json': { schema: errorJson } } },
            503: serviceUnavailable
          }
        }
      }
    },
    components: {
      securitySchemes: { bearerAuth },
      parameters: {
        requestId: {
          name: 'X-Request-Id',
          in: 'header',
          required: false,
          description: 'Correlaciona pedido com logs; ecoado na resposta.',
          schema: { type: 'string', maxLength: 128 }
        }
      }
    }
  };
}

export const OPENAPI_DOCS_HTML = `<!doctype html>
<meta charset=utf-8>
<title>Ripper API docs</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;line-height:1.5;padding:0 1rem}</style>
<h1>Ripper HTTP API</h1>
<p>Documentação mínima (sem Swagger UI). Especificação OpenAPI 3:</p>
<p><a href="/openapi.json">/openapi.json</a></p>
<p>Autenticação: <code>Authorization: Bearer &lt;RIPPER_TOKEN&gt;</code> nas rotas <code>/api/*</code>; <code>/metrics</code> também aceita scrape público com <code>RIPPER_METRICS_PUBLIC=1</code>.</p>
`;
