import { useEffect, useState, useSyncExternalStore } from 'react';
import { fmtAgoLocalized, getCachedUiLocale, translateApiError } from '../../lib/i18n.mjs';

/* ---------- API ---------- */
export class ApiError extends Error {}
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
  browser: { label: 'Navegador', icon: 'compass', desc: 'Abre sites no computador dele; você vê a tela ao vivo. Precisa do modo Docker.' },
  computer: { label: 'Computador', icon: 'terminal', desc: 'VM própria: instala pacotes, roda código, compartilha links.' },
  memory: { label: 'Memória', icon: 'brain', desc: 'Guarda o que importa entre conversas.' },
  routines: { label: 'Rotinas', icon: 'clock', desc: 'Age sozinho em horários definidos.' },
  files: { label: 'Análise de arquivos', icon: 'file', desc: 'Lê documentos, planilhas e código enviados.' },
  plugins: { label: 'Plugins MCP', icon: 'plug', desc: 'Usa as integrações que você conectou.' },
  social: { label: 'Publicação social', icon: 'share', desc: 'Envia rascunhos ou posts para webhooks configurados (Slack, HTTP).' }
};
export const STEP_LABEL = {
  computer_exec: 'Rodando no computador', computer_share: 'Gerando link', WebSearch: 'Pesquisando na web', WebFetch: 'Lendo página',
  remember: 'Guardando na memória', schedule_routine: 'Criando rotina',
  browser_open: 'Abrindo página', browser_click: 'Clicando', browser_type: 'Digitando', browser_scroll: 'Rolando a página', browser_read: 'Lendo a página',
  send_message: 'Mandando mensagem', save_artifact: 'Salvando artefato', read_artifact: 'Lendo artefato', use_skill: 'Usando skill', save_skill: 'Guardando skill',
  post_social: 'Publicando', send_webhook: 'Enviando webhook', list_social_webhooks: 'Listando webhooks'
};
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
