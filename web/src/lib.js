import { useEffect, useState, useSyncExternalStore } from 'react';
import { fmtAgoLocalized, getCachedUiLocale, translateApiError } from '../../lib/i18n.mjs';

/* ---------- API ---------- */
export class ApiError extends Error {}
export async function apiUpload(path, formData, { signal } = {}) {
  const res = await fetch(path, { method: 'POST', body: formData, signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Erro ${res.status}`);
  return data;
}

export function brandLogoSrc(logoUrl) {
  if (!logoUrl) return null;
  if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
  if (logoUrl.startsWith('brand/')) return `/api/brand/file/${encodeURIComponent(logoUrl.slice('brand/'.length))}`;
  return null;
}

export function brandTitle(settings) {
  const n = settings?.brand?.displayName?.trim();
  return n || 'Ripper';
}

export async function api(path, { method = 'GET', body, raw, headers, signal } = {}) {
  const res = await fetch(path, {
    method, signal,
    headers: raw ? headers : { 'content-type': 'application/json', ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(translateApiError(data.error || `Erro ${res.status}`, getCachedUiLocale()));
  return data;
}

/* ---------- rota por hash: #/agents/abc ---------- */
const subscribe = cb => (addEventListener('hashchange', cb), () => removeEventListener('hashchange', cb));
export function useRoute() {
  const hash = useSyncExternalStore(subscribe, () => location.hash || '#/');
  const [path, qs] = hash.slice(1).split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}
export const go = to => { if (location.hash !== '#' + to) location.hash = to; };

/* ---------- armazenamento local seguro ---------- */
export const local = {
  get(k, d) { try { const v = localStorage.getItem('ripper.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ripper.' + k, JSON.stringify(v)); } catch {} }
};

/* ---------- tema ---------- */
export function useTheme() {
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [pref, setPref] = useState(() => local.get('theme', null));
  const [sys, setSys] = useState(() => media?.matches ? 'dark' : 'light');
  useEffect(() => { if (!media) return; const f = e => setSys(e.matches ? 'dark' : 'light'); media.addEventListener('change', f); return () => media.removeEventListener('change', f); }, []);
  const theme = pref || sys;
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return [theme, () => { const n = theme === 'dark' ? 'light' : 'dark'; setPref(n); local.set('theme', n); }];
}

export function useMediaQuery(q) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

/* ---------- formatação ---------- */
export const fmtSize = n => n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`;
export const fmtTime = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export function fmtAgo(t) {
  return fmtAgoLocalized(t, getCachedUiLocale());
}

/* ---------- ferramentas: rótulos humanos ---------- */
export const TOOL_INFO = {
  web: { label: 'Pesquisa na web', icon: 'globe', desc: 'Busca e lê páginas, com as fontes.' },
  browser: { label: 'Navegador', icon: 'compass', desc: 'Abre sites no computador dele; você vê a tela ao vivo.' },
  computer: { label: 'Computador', icon: 'terminal', desc: 'VM própria: instala pacotes, roda código, compartilha links.' },
  memory: { label: 'Memória', icon: 'brain', desc: 'Guarda o que importa entre conversas.' },
  routines: { label: 'Rotinas', icon: 'clock', desc: 'Age sozinho em horários definidos.' },
  files: { label: 'Análise de arquivos', icon: 'file', desc: 'Lê documentos, planilhas e código enviados.' },
  plugins: { label: 'Conectores', icon: 'plug', desc: 'Usa os apps que você conectou: Google Agenda, Gmail, Notion…' },
  social: { label: 'Publicação social', icon: 'share', desc: 'Envia rascunhos ou posts para webhooks configurados (Slack, HTTP).' }
};
export const STEP_LABEL = {
  computer_exec: 'Rodando no computador', computer_share: 'Gerando link', WebSearch: 'Pesquisando na web', WebFetch: 'Lendo página',
  remember: 'Guardando na memória', schedule_routine: 'Criando rotina',
  browser_open: 'Abrindo página', browser_click: 'Clicando', browser_type: 'Digitando', browser_scroll: 'Rolando a página', browser_read: 'Lendo a página',
  send_message: 'Mandando mensagem', call_agent: 'Chamando colega', save_artifact: 'Salvando artefato', read_artifact: 'Lendo artefato', use_skill: 'Usando skill', save_skill: 'Guardando skill',
  post_social: 'Publicando', send_webhook: 'Enviando webhook', list_social_webhooks: 'Listando webhooks',
  deliver_file: 'Entregando arquivo', use_connectors: 'Abrindo conectores', find_script: 'Procurando script pronto', save_script: 'Guardando script', handoff: 'Passando a tarefa',
  notify_owner: 'Avisando você', whatsapp_send: 'Enviando WhatsApp', whatsapp_chats: 'Vendo conversas do WhatsApp', whatsapp_read: 'Lendo conversa do WhatsApp', whatsapp_contacts: 'Buscando contato',
  list_skills: 'Listando skills', x9_context: 'Coletando dados', x9_checklist: 'Rodando checklist'
};
/** Rótulo humano de uma ferramenta; conectores (mcp__claude_ai_Google_Calendar__list_events) viram "Google Calendar: list events". */
export function stepLabel(tool) {
  if (STEP_LABEL[tool]) return STEP_LABEL[tool];
  const m = /^mcp__(?:claude_ai_)?(.+?)__(.+)$/.exec(String(tool || ''));
  if (m) return `${m[1].replace(/_/g, ' ')}: ${m[2].replace(/_/g, ' ')}`;
  return `Usando ${tool}`;
}
export const TONES = [['direto', 'Direto'], ['amigavel', 'Amigável'], ['formal', 'Formal'], ['tecnico', 'Técnico']];
export const FORMALITIES = [['informal', 'Informal'], ['neutro', 'Neutro'], ['formal', 'Formal']];

/** Tema efetivo ('light' | 'dark'), reagindo a mudanças do atributo data-theme. */
const themeSub = cb => { const mo = new MutationObserver(cb); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => mo.disconnect(); };
export const useDark = () => useSyncExternalStore(themeSub, () => document.documentElement.dataset.theme === 'dark');

/** Cor do nome de um agente, legível no fundo claro e no escuro. */
export function nameColor(agent, palette) {
  const c = agent?.avatar?.color || palette?.[agent?.avatar?.type];
  const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
  if (!m) return 'var(--ink-2)';
  const n = parseInt(m[1], 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.72 || lum < 0.18 ? 'var(--ink-2)' : c;
}
