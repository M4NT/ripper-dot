// Motor da UI generativa: valida, gera o prompt a partir do catálogo,
// interpreta blocos parciais no streaming e transforma cliques em mensagem.
import { GENUI_CATALOG, GENUI_NAMES, genuiEntry, componentFromTool, isGenuiTool } from './genui-catalog.mjs';
import { settingCardView } from './setting-cards.mjs';
import { canUseFile } from './agent-flow.mjs';

const newId = () => globalThis.crypto.randomUUID();

export { GENUI_CATALOG, GENUI_NAMES, genuiEntry, componentFromTool, isGenuiTool };
export { GENUI_TOOL_NAMES } from './genui-catalog.mjs';

const UI_STATES = new Set(['input-streaming', 'input-available', 'output-error', 'answered', 'approved', 'denied', 'expired']);

function firstZodIssue(err) {
  const issue = err?.issues?.[0];
  if (!issue) return 'dados inválidos';
  const path = (issue.path || []).join('.') || 'campo';
  return `${path}: ${issue.message}`;
}

function pickKnown(props, entry) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  const keys = Object.keys(entry.schema.shape || {});
  const out = {};
  for (const k of keys) if (k in props) out[k] = props[k];
  return out;
}

/** Valida as props. Em `partial` (streaming) aceita campos faltando e devolve o que já deu. */
export function validateGenui(name, props, { partial = false } = {}) {
  const entry = genuiEntry(name);
  if (!entry) return { ok: false, error: `componente desconhecido: ${name}` };
  const data = props && typeof props === 'object' ? props : {};
  const schema = partial ? entry.schema.partial() : entry.schema;
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, props: parsed.data, partial };
  if (partial) return { ok: false, props: pickKnown(data, entry), error: firstZodIssue(parsed.error), partial: true };
  return { ok: false, error: firstZodIssue(parsed.error), props: data };
}

export function genuiToText(name, props) {
  const entry = genuiEntry(name);
  if (!entry) return '';
  try { return String(entry.toText(props || {}) || '').trim(); }
  catch { return ''; }
}

export function describeGenuiTool(name, input = {}) {
  const n = String(name || '').replace(/^mcp__ripper__/, '');
  const component = componentFromTool(n);
  if (!component) return null;
  const entry = genuiEntry(component);
  const detail = input.title || input.prompt || input.app || input.name || input.url || entry?.title || component;
  return { tool: n, detail: String(detail).slice(0, 160) };
}

export function genuiStepLabel(tool) {
  const component = componentFromTool(tool);
  const entry = genuiEntry(component);
  return entry ? `Mostrando ${entry.title.toLowerCase()}` : null;
}

/** Trecho de system prompt gerado do catálogo — nunca diverge do que a tela sabe renderizar. */
export function genuiSystemPrompt() {
  const lines = GENUI_NAMES.map(name => {
    const e = GENUI_CATALOG[name];
    return `- show_${name} — ${e.title}. USE: ${e.when} NÃO USE: ${e.whenNot}`;
  });
  return `## Componentes de interface
Você pode mostrar componentes no chat chamando as ferramentas show_*.
Regras:
- Prefira um componente a markdown quando a resposta for dados estruturados, escolha do usuário, aprovação, progresso ou prévia. Nunca escreva tabela markdown com 3+ linhas: use show_data_table.
- Escreva no máximo 1–2 frases de contexto antes do componente; não repita no texto o que o componente já mostra.
- Pergunta com opções fechadas → show_question (nunca liste opções numeradas no texto).
- Ação com efeito externo (enviar, publicar, pagar, apagar) → show_approval antes; nunca peça "responda sim".
- Não peça senha, token ou login em componente nem em texto. Isso ainda não tem cofre neste fluxo.
- Imagens (logo, ícone, galeria, slide) só em data: ou caminho do Ripper (/api/files/…). Links só http(s) ou relativos.
- Se nenhum componente encaixar, responda em texto normal. Não invente componentes.
- Layout livre (dashboard composto) ainda pode usar um bloco \`\`\`openui, mas cartões do catálogo vêm das ferramentas show_*.
${lines.join('\n')}`;
}

/**
 * Fecha JSON incompleto o suficiente para o streaming desenhar um esqueleto.
 * Não tenta ser um parser completo: se não der, devolve vazio.
 */
export function closePartialJson(src) {
  const s = String(src || '');
  let out = '';
  let inStr = false;
  let esc = false;
  const stack = [];
  for (const ch of s) {
    out += ch;
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.at(-1) === ch) stack.pop();
    }
  }
  if (inStr) {
    out += '"';
    // chave incompleta (`{"a":1,"op`) vira `"op"` sem valor — descarta
    const lastColon = out.lastIndexOf(':');
    const lastComma = out.lastIndexOf(',');
    const lastOpen = out.lastIndexOf('{');
    const lastPunct = Math.max(lastComma, lastOpen, lastColon);
    if (lastPunct !== lastColon) {
      out = lastComma > lastOpen ? out.slice(0, lastComma) : out.slice(0, lastOpen + 1);
    }
  }
  // vírgula ou dois-pontos no fim: completa com null
  const trimmed = out.replace(/\s+$/, '');
  if (/[,:]$/.test(trimmed)) out = trimmed + 'null';
  out += stack.reverse().join('');
  try { return { ok: true, value: JSON.parse(out) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

export function parseIncrementalJson(src) {
  const raw = String(src || '').trim();
  if (!raw) return { value: undefined, complete: false, state: 'input-streaming' };
  try { return { value: JSON.parse(raw), complete: true, state: 'input-available' }; }
  catch {
    const closed = closePartialJson(raw);
    if (closed.ok) return { value: closed.value, complete: false, state: 'input-streaming' };
    return { value: undefined, complete: false, state: 'input-streaming', error: closed.error };
  }
}

/** Interpreta o conteúdo de um bloco ```genui (JSON {component,props} ou "nome\\n{props}"). */
export function parseGenuiFence(code, { live = false, allowedFileIds } = {}) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return { ok: false, state: 'input-streaming', part: null };
  const named = /^([a-z_]+)\s*\n([\s\S]*)$/.exec(trimmed);
  let component;
  let props;
  let complete = !live;
  if (named && GENUI_CATALOG[named[1]]) {
    component = named[1];
    const parsed = parseIncrementalJson(named[2] || '{}');
    props = parsed.value && typeof parsed.value === 'object' ? parsed.value : {};
    complete = parsed.complete;
  } else {
    const parsed = parseIncrementalJson(trimmed);
    if (!parsed.value || typeof parsed.value !== 'object') {
      return { ok: false, state: parsed.state, error: parsed.error || 'JSON incompleto', part: null };
    }
    if (parsed.value.component) {
      component = String(parsed.value.component);
      props = parsed.value.props && typeof parsed.value.props === 'object' ? parsed.value.props : {};
    } else {
      return { ok: false, state: parsed.state, error: 'faltou component', part: null };
    }
    complete = parsed.complete;
  }
  return presentGenui({ component, props, partial: live || !complete, allowedFileIds });
}

export function presentGenui({ component, props, partial = false, partId, chatId, allowedFileIds }) {
  const entry = genuiEntry(component);
  if (!entry) {
    const text = props && typeof props === 'object' ? JSON.stringify(props) : String(props || '');
    return { ok: false, fallback: true, text, warning: `Componente desconhecido: ${component}`, part: null };
  }
  const check = validateGenui(component, props, { partial });
  const clean = sanitizeGenuiProps(component, check.props || {}, { allowedFileIds });
  const part = {
    id: partId || newId(),
    kind: 'ui',
    component,
    version: entry.version,
    props: clean,
    state: check.ok ? (partial ? 'input-streaming' : 'input-available') : (partial ? 'input-streaming' : 'output-error'),
    interactive: !!entry.interactive,
    chatId: chatId || undefined
  };
  const text = genuiToText(component, clean) || entry.title;
  if (!check.ok && !partial) {
    return { ok: false, fallback: true, text, warning: check.error, part: { ...part, state: 'output-error', error: check.error } };
  }
  return { ok: true, part, text, warning: check.partial ? check.error : undefined };
}

const ACTION_BY_COMPONENT = {
  approval: new Set(['allow', 'deny']),
  question: new Set(['submit']),
  connect_app: new Set(['connect', 'cancel', 'retry']),
  draft_message: new Set(['send', 'discard', 'edit']),
  slides: new Set(['choose']),
  setting: new Set(['apply', 'dismiss'])
};

/** Aplica o clique do usuário no cartão e devolve o texto que volta para o agente. */
export function applyUiAction(part, { action, payload } = {}) {
  if (!part || part.kind !== 'ui') return { ok: false, error: 'cartão não encontrado' };
  if (part.state && !['input-available', 'input-streaming'].includes(part.state)) {
    return { ok: false, error: 'este cartão já foi respondido' };
  }
  const entry = genuiEntry(part.component);
  if (!entry) return { ok: false, error: 'componente desconhecido' };
  const allowed = ACTION_BY_COMPONENT[part.component];
  if (!allowed) return { ok: false, error: 'este componente não é interativo' };
  if (!allowed.has(action)) return { ok: false, error: `ação inválida: ${action}` };

  let userText = '';
  let nextState = 'answered';
  let applySetting = null;
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  let nextProps = part.props;

  if (part.component === 'approval') {
    nextState = action === 'deny' ? 'denied' : 'approved';
    userText = action === 'deny' ? 'Neguei a ação.' : 'Permiti esta vez.';
  } else if (part.component === 'question') {
    const selected = Array.isArray(safePayload.selected) ? safePayload.selected : [];
    const other = String(safePayload.other || '').trim();
    const labels = (part.props?.options || []).filter(o => selected.includes(o.id)).map(o => o.label);
    if (other) labels.push(other);
    if (!labels.length) return { ok: false, error: 'escolha ao menos uma opção' };
    userText = `Escolhi: ${labels.join(', ')}`;
  } else if (part.component === 'connect_app') {
    nextState = action === 'cancel' ? 'denied' : 'answered';
    userText = action === 'cancel' ? `Cancelei a conexão com ${part.props.app}.` : action === 'retry' ? `Tente de novo conectar ${part.props.app}.` : `Conectei ${part.props.app}. Pode continuar.`;
  } else if (part.component === 'draft_message') {
    const body = typeof safePayload.body === 'string' ? String(safePayload.body).slice(0, 20000) : String(part.props.body || '');
    nextProps = { ...part.props, body };
    if (action === 'edit') {
      return { ok: true, part: { ...part, props: nextProps }, userText: null, continue: false };
    }
    nextState = action === 'discard' ? 'denied' : 'answered';
    userText = action === 'discard'
      ? 'Descartei o rascunho.'
      : `Pode enviar o rascunho${part.props.to ? ` para ${part.props.to}` : ''}.\n\n${body}`;
  } else if (part.component === 'slides') {
    const sample = (part.props.samples || []).find(s => s.id === safePayload.id);
    if (!sample) return { ok: false, error: 'amostra desconhecida' };
    userText = `Escolhi o visual "${sample.title}".`;
  } else if (part.component === 'setting') {
    const official = settingCardView({}, part.props?.key, part.props?.proposed);
    if (!official) return { ok: false, error: 'configuração desconhecida' };
    nextProps = {
      ...part.props,
      key: official.key,
      label: official.label,
      description: official.desc,
      proposed: official.proposed,
      sensitive: official.sensitive
    };
    if (part.props?.channelLocked) return { ok: false, error: 'configurações não se aplicam em conversas de canal' };
    if (action === 'apply' && official.sensitive) {
      return {
        ok: true,
        part: { ...part, props: { ...nextProps, pendingApproval: true }, state: 'input-available' },
        userText: null,
        continue: false,
        needsApproval: true,
        applySetting: { key: official.key, on: official.proposed, sensitive: true }
      };
    }
    nextState = action === 'dismiss' ? 'denied' : 'approved';
    userText = action === 'dismiss'
      ? `Mantive "${official.label}" como estava.`
      : `${official.proposed ? 'Ligue' : 'Desligue'} "${official.label}".`;
    if (action === 'apply') applySetting = { key: official.key, on: official.proposed, sensitive: false };
  }

  const updated = {
    ...part,
    props: nextProps,
    state: nextState,
    action,
    payload: safePayload,
    decidedAt: Date.now()
  };
  return { ok: true, part: updated, userText, continue: true, applySetting };
}

const uiLive = new Map(); // partId → { chatId, part }

export function rememberUiPart(chatId, part) {
  if (part?.id && chatId) uiLive.set(part.id, { chatId, part });
}

/** Acha o cartão na conversa ou no mapa do turno atual — sem gravar no turno anterior. */
export function findUiPart(chat, partId) {
  for (const message of chat?.messages || []) {
    const step = (message.steps || []).find(s => s.kind === 'ui' && s.id === partId);
    if (step) return { message, step, live: false };
  }
  const live = uiLive.get(partId);
  if (live && live.chatId === chat?.id) return { message: null, step: live.part, live: true };
  return null;
}

export function forgetUiParts(chatId) {
  for (const [id, v] of uiLive) if (v.chatId === chatId) uiLive.delete(id);
}

export function liveUiCount(chatId) {
  let n = 0;
  for (const v of uiLive.values()) if (!chatId || v.chatId === chatId) n++;
  return n;
}

function sameProps(a, b) {
  try { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }
  catch { return false; }
}

export function findLiveByProps(chatId, component, props) {
  for (const v of uiLive.values()) {
    if (v.chatId === chatId && v.part?.component === component && sameProps(v.part.props, props)) return v.part;
  }
  return null;
}

/** Acha o cartão pelo conteúdo (cerca ```genui): mensagens gravadas, depois o mapa do turno. */
export function findUiPartByProps(chat, component, props) {
  for (const message of chat?.messages || []) {
    const step = (message.steps || []).find(s => s.kind === 'ui' && s.component === component && sameProps(s.props, props));
    if (step) return { message, step, live: false };
  }
  const live = findLiveByProps(chat?.id, component, props);
  if (live) return { message: null, step: live, live: true };
  return null;
}

/** Registra um cartão da cerca (ou das props) com id do servidor. Reusa se já existir. */
export function registerUiPart(chat, { fence, component, props, partId, allowedFileIds } = {}) {
  const shown = fence != null && fence !== ''
    ? parseGenuiFence(fence, { allowedFileIds })
    : presentGenui({ component, props, partId, chatId: chat?.id, allowedFileIds });
  if (!shown.part) return { ok: false, error: shown.warning || shown.error || 'cartão inválido' };
  const existing = findUiPartByProps(chat, shown.part.component, shown.part.props);
  const part = existing?.step || shown.part;
  part.chatId = chat?.id;
  if (chat?.channel && part.component === 'setting' && (!part.state || part.state === 'input-available' || part.state === 'input-streaming')) {
    Object.assign(part, lockGenuiSettingIfChannel(part, chat));
  }
  if (!existing || existing.live) rememberUiPart(chat?.id, part);
  return { ok: true, part, existing: !!existing };
}

/** Junta passos ui sem duplicar id; prefere o estado já decidido do mapa. */
export function mergeUiSteps(steps = []) {
  const byId = new Map();
  const rest = [];
  for (const s of steps) {
    if (s?.kind === 'ui' && s.id) {
      const prev = byId.get(s.id);
      if (!prev || (s.state && s.state !== 'input-available' && s.state !== 'input-streaming')) byId.set(s.id, s);
      continue;
    }
    rest.push(s);
  }
  return [...rest, ...byId.values()];
}

export function collectFenceParts(chatId, text, chat, { allowedFileIds } = {}) {
  const out = [];
  const re = /```genui[ \t]*\n?([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const registered = registerUiPart(chat || { id: chatId, messages: [] }, { fence: m[1], allowedFileIds });
    if (!registered.ok) continue;
    registered.part.fromFence = true;
    out.push(registered.part);
  }
  return out;
}

const DATA_IMAGE = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i;

const RIPPER_FILE = /^\/api\/files\/([A-Za-z0-9][A-Za-z0-9_-]{0,80})$/;

/** Imagem só data: raster (sem SVG) ou `/api/files/<id>` da conversa/agente. Sem https. */
export function safeMediaUrl(url, { allowedFileIds } = {}) {
  const s = String(url || '').trim();
  if (!s || s.length > 500) return '';
  if (DATA_IMAGE.test(s)) return s;
  const m = RIPPER_FILE.exec(s);
  if (!m) return '';
  if (allowedFileIds && !allowedFileIds.has(m[1])) return '';
  return s;
}

/** Arquivos que um cartão genui pode citar: desta conversa, do agente, do projeto ou do time. */
export function allowedGenuiFileIds(files = [], chat) {
  const ids = new Set();
  if (!chat) return ids;
  const agentIds = [chat.agentId, ...(chat.agentIds || [])].filter(Boolean);
  for (const f of files) {
    if (!f?.id) continue;
    if (f.chatId && f.chatId === chat.id) { ids.add(f.id); continue; }
    if (agentIds.some(aid => canUseFile(f, { id: aid }, chat))) ids.add(f.id);
  }
  return ids;
}

/** Em conversa de canal o interruptor não aplica — igual ao offer_setting. */
export function lockGenuiSettingIfChannel(part, chat) {
  if (!part || part.component !== 'setting' || !chat?.channel) return part;
  return {
    ...part,
    state: 'expired',
    interactive: false,
    props: { ...part.props, channelLocked: true }
  };
}

/** Cercas ```genui no texto (conteúdo interno, sem a marca). */
export function extractGenuiFences(text) {
  const out = [];
  const re = /```genui[ \t]*\n?([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1].trim());
  return out;
}

function fenceFingerprint(src) {
  const shown = parseGenuiFence(src);
  if (!shown.part) return '';
  try { return JSON.stringify({ component: shown.part.component, props: shown.part.props }); }
  catch { return ''; }
}

/** A cerca precisa aparecer numa mensagem do assistente (ou no texto ao vivo do turno). */
export function fenceInAssistantMessages(chat, fence, extraText) {
  const needle = fenceFingerprint(fence);
  if (!needle) return false;
  const texts = [];
  for (const m of chat?.messages || []) {
    if (m.role === 'assistant' && m.content) texts.push(m.content);
  }
  if (extraText) texts.push(extraText);
  for (const t of texts) {
    for (const f of extractGenuiFences(t)) {
      if (fenceFingerprint(f) === needle) return true;
    }
  }
  return false;
}

/** href só http(s) ou caminho relativo. */
export function safeHref(url) {
  const s = String(url || '').trim();
  if (!s || s.length > 500) return '';
  if (s.startsWith('/') && !s.startsWith('//') && !s.includes('://')) return s;
  if (!/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return u.href;
  } catch {
    return '';
  }
}

export function hrefHost(url) {
  const s = safeHref(url);
  if (!s || s.startsWith('/')) return '';
  try { return new URL(s).host; } catch { return ''; }
}

export function sanitizeGenuiProps(component, props, { allowedFileIds } = {}) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  const out = { ...props };
  const media = u => safeMediaUrl(u, { allowedFileIds });
  for (const k of ['logo', 'icon', 'src', 'preview']) {
    if (k in out) {
      const v = media(out[k]);
      if (v) out[k] = v; else delete out[k];
    }
  }
  if (out.fileId) {
    if (!media(`/api/files/${out.fileId}`)) delete out.fileId;
  }
  if (component === 'media_gallery' && Array.isArray(out.items)) {
    out.items = out.items.map(it => {
      const src = media(it?.src);
      return src ? { ...it, src } : { ...it, src: '' };
    });
  }
  if (component === 'slides' && Array.isArray(out.samples)) {
    out.samples = out.samples.map(s => {
      if (!s?.preview) return s;
      const preview = media(s.preview);
      return preview ? { ...s, preview } : { ...s, preview: undefined };
    });
  }
  if ('url' in out) {
    const raw = String(out.url || '').trim();
    if (RIPPER_FILE.test(raw) || raw.startsWith('/api/files/')) {
      const v = media(raw);
      if (v) out.url = v; else delete out.url;
    } else {
      const href = safeHref(out.url);
      if (href) out.url = href; else delete out.url;
    }
  }
  if ('connectUrl' in out) {
    const href = safeHref(out.connectUrl);
    if (href) out.connectUrl = href; else delete out.connectUrl;
  }
  if (component === 'data_table' && Array.isArray(out.columns) && Array.isArray(out.rows)) {
    const linkKeys = out.columns.filter(c => c.type === 'link').map(c => c.key);
    if (linkKeys.length) {
      out.rows = out.rows.map(r => {
        const next = { ...r };
        for (const k of linkKeys) if (k in next) next[k] = safeHref(next[k]) || '';
        return next;
      });
    }
  }
  if (component === 'setting' && out.key) {
    const official = settingCardView({}, out.key, out.proposed);
    if (official) {
      out.label = official.label;
      out.description = official.desc;
      out.sensitive = official.sensitive;
    }
  }
  return out;
}

export const HTML_PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'";

export function htmlPreviewSrcdoc(html) {
  return `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">${String(html || '')}`;
}

/** Versão leve para live/SSE: sem HTML de 80 KB nem tabela inteira. */
export function slimUiPart(part) {
  if (!part || part.kind !== 'ui') return part;
  const props = part.props || {};
  const name = part.component;
  let slim = props;
  if (name === 'html_preview') {
    slim = { title: props.title, bytes: String(props.html || '').length };
  } else if (name === 'data_table') {
    slim = { title: props.title, columns: props.columns, rows: (props.rows || []).slice(0, 8), rowCount: (props.rows || []).length, caption: props.caption };
  } else if (name === 'draft_message') {
    slim = { ...props, body: String(props.body || '').slice(0, 400) };
  } else if (name === 'media_gallery') {
    slim = { title: props.title, items: (props.items || []).slice(0, 4) };
  }
  return { id: part.id, kind: 'ui', component: name, version: part.version, state: part.state, interactive: part.interactive, chatId: part.chatId, props: slim, slim: true };
}

export function detectMarkdownTableAbuse(text) {
  const rows = String(text || '').split('\n').filter(l => /^\s*\|.+\|\s*$/.test(l));
  const sep = rows.filter(l => /\|?\s*-{3,}/.test(l)).length;
  const data = rows.length - sep;
  return data >= 3;
}

export function isUiState(state) {
  return UI_STATES.has(state);
}

/** Ferramentas show_* não têm efeito fora do Ripper: podem repetir na retomada. */
export function genuiSafeToRepeat() {
  return GENUI_NAMES.map(n => `show_${n}`);
}
