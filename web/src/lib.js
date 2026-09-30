import { useEffect, useState, useSyncExternalStore } from 'react';

/* ---------- API ---------- */
export class ApiError extends Error {}
export async function api(path, { method = 'GET', body, raw, headers, signal } = {}) {
  const res = await fetch(path, {
    method, signal,
    headers: raw ? headers : { 'content-type': 'application/json', ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Erro ${res.status}`);
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
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/* ---------- ferramentas: rótulos humanos ---------- */
export const TOOL_INFO = {
  web: { label: 'Pesquisa na web', icon: 'globe', desc: 'Busca e lê páginas, com as fontes.' },
  computer: { label: 'Computador', icon: 'terminal', desc: 'VM própria: instala pacotes, roda código, compartilha links.' },
  memory: { label: 'Memória', icon: 'brain', desc: 'Guarda o que importa entre conversas.' },
  routines: { label: 'Rotinas', icon: 'clock', desc: 'Age sozinho em horários definidos.' },
  files: { label: 'Análise de arquivos', icon: 'file', desc: 'Lê documentos, planilhas e código enviados.' },
  plugins: { label: 'Plugins MCP', icon: 'plug', desc: 'Usa as integrações que você conectou.' }
};
export const STEP_LABEL = {
  computer_exec: 'Rodando no computador', computer_share: 'Gerando link', WebSearch: 'Pesquisando na web', WebFetch: 'Lendo página',
  remember: 'Guardando na memória', schedule_routine: 'Criando rotina'
};
export const TONES = [['direto', 'Direto'], ['amigavel', 'Amigável'], ['formal', 'Formal'], ['tecnico', 'Técnico']];

/** Tema efetivo ('light' | 'dark'), reagindo a mudanças do atributo data-theme. */
const themeSub = cb => { const mo = new MutationObserver(cb); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => mo.disconnect(); };
export const useDark = () => useSyncExternalStore(themeSub, () => document.documentElement.dataset.theme === 'dark');
