/**
 * Status honesto de privacidade/LGPD — o que o Ripper implementa localmente.
 * Não alega conformidade legal; só expõe capacidades reais.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function buildLgpdStatus({ settings } = {}) {
  const tokenConfigured = Boolean(process.env.RIPPER_TOKEN?.trim());
  const dataScript = fileURLToPath(new URL('../scripts/ripper-data.mjs', import.meta.url));
  return {
    available: true,
    productTelemetry: false,
    localFirst: true,
    ripperDataFromEnv: Boolean(process.env.RIPPER_DATA),
    accessControl: tokenConfigured ? 'bearer_token' : 'open_local',
    redactionInApi: true,
    redactionInLogs: true,
    dataInventoryCli: existsSync(dataScript),
    settingsNameStored: Boolean(settings?.name?.trim()),
    notes: [
      'O Ripper não envia telemetria de produto; dados ficam em RIPPER_DATA (ou ./data).',
      'Redação de segredos em respostas da API e em diagnósticos — não substitui DPA ou política de privacidade.',
      'Conformidade LGPD/GDPR depende de como você opera a instância; este painel só descreve o software.'
    ]
  };
}
