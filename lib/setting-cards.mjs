// Configurações que um agente pode oferecer na conversa como um interruptor.
// O agente só mostra; quem liga ou desliga é a pessoa, com um clique no balão.
// sensitive: pede confirmação extra antes de aplicar.
export const SETTING_CARDS = {
  'claude.autoSwitch': { label: 'Trocar de conta do Claude sozinho', desc: 'Quando uma conta atinge o limite, o Ripper passa para a próxima.' },
  'inputQueue.enabled': { label: 'Juntar mensagens seguidas', desc: 'Espera 2,5 s e junta mensagens enviadas em sequência numa só.' },
  'memory': { label: 'Agentes lembram de você', desc: 'Guardam preferências e fatos importantes entre conversas.' },
  'pulse.enabled': { label: 'Resumo diário', desc: 'Todo dia, um resumo do que os agentes fizeram aparece na Caixa.' },
  'pulse.whatsapp': { label: 'Resumo diário no WhatsApp', desc: 'O resumo diário também chega no seu WhatsApp.' },
  'backup.enabled': { label: 'Backup automático diário', desc: 'Uma cópia dos seus dados por dia.', sensitiveOff: true },
  'whatsappWeb.readAll': { label: 'Ler minhas conversas do WhatsApp', desc: 'Os agentes passam a ler as conversas do WhatsApp conectado no Ripper (a partir de agora). Cada leitura fica registrada.', sensitive: true },
  'whatsappWeb.paused': { label: 'Pausar o WhatsApp', desc: 'Os agentes param de responder no WhatsApp até você retomar.' },
  'lgpd.enabled': { label: 'Proteção de dados pessoais (LGPD)', desc: 'Liga as regras de LGPD: esconder dados pessoais e registrar consentimentos.' },
  'lgpd.redactBeforeLlm': { label: 'Esconder CPF e documentos da IA', desc: 'Troca CPF, documentos e dados financeiros por marcadores antes de enviar para a IA.' },
  'computer.allowLocalCommands': { label: 'Comandos direto no seu computador', desc: 'Agentes sem contêiner podem rodar comandos na sua máquina.', sensitive: true },
  'ui.mode': { label: 'Modo Enterprise', desc: 'Mostra projetos, grupos e as opções avançadas.', on: 'enterprise', off: 'simple' }
};

const getPath = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
const card = key => SETTING_CARDS[key];

/** Valor atual como liga/desliga. */
export function settingIsOn(settings, key) {
  const c = card(key), v = getPath(settings, key);
  return c?.on ? v === c.on : !!v;
}

/** Remendo para patchSettings, ex.: ('claude.autoSwitch', true) → { claude: { autoSwitch: true } } */
export function settingPatch(key, on) {
  const c = card(key);
  if (!c) throw new Error(`Configuração desconhecida: ${key}`);
  const value = c.on ? (on ? c.on : c.off) : !!on;
  return key.split('.').reduceRight((acc, k) => ({ [k]: acc }), value);
}

/** O que o cartão mostra: rótulo, explicação, estado atual e proposto, se pede confirmação. */
export function settingCardView(settings, key, on) {
  const c = card(key);
  if (!c) return null;
  return { key, label: c.label, desc: c.desc, current: settingIsOn(settings, key), proposed: !!on, sensitive: !!(c.sensitive && on) || !!(c.sensitiveOff && !on) };
}
