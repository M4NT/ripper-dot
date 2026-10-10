// Motor da UI generativa: valida, gera o prompt a partir do catálogo,
// interpreta blocos parciais no streaming e transforma cliques em mensagem.
import { randomUUID } from 'node:crypto';
import { GENUI_CATALOG, GENUI_NAMES, genuiEntry, componentFromTool, isGenuiTool } from './genui-catalog.mjs';

const newId = () => randomUUID();

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
- Formulário com senha, token ou login → show_secure_form. Os valores nunca voltam para você.
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
export function parseGenuiFence(code, { live = false } = {}) {
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
  return presentGenui({ component, props, partial: live || !complete });
}

export function presentGenui({ component, props, partial = false, partId, chatId }) {
  const entry = genuiEntry(component);
  if (!entry) {
    const text = props && typeof props === 'object' ? JSON.stringify(props) : String(props || '');
    return { ok: false, fallback: true, text, warning: `Componente desconhecido: ${component}`, part: null };
  }
  const check = validateGenui(component, props, { partial });
  const part = {
    id: partId || newId(),
    kind: 'ui',
    component,
    version: entry.version,
    props: check.props || {},
    state: check.ok ? (partial ? 'input-streaming' : 'input-available') : (partial ? 'input-streaming' : 'output-error'),
    interactive: !!entry.interactive,
    chatId: chatId || undefined
  };
  const text = genuiToText(component, check.props || props || {}) || entry.title;
  if (!check.ok && !partial) {
    return { ok: false, fallback: true, text, warning: check.error, part: { ...part, state: 'output-error', error: check.error } };
  }
  return { ok: true, part, text, warning: check.partial ? check.error : undefined };
}

const ACTION_BY_COMPONENT = {
  approval: new Set(['allow', 'always', 'deny']),
  question: new Set(['submit']),
  connect_app: new Set(['connect', 'cancel', 'retry']),
  secure_form: new Set(['submit', 'cancel']),
  draft_message: new Set(['send', 'discard', 'edit']),
  slides: new Set(['choose']),
  setting: new Set(['apply', 'dismiss'])
};

function redactSecureValues(payload) {
  const names = Object.keys(payload?.values || payload || {}).filter(k => k !== 'values');
  const fields = payload?.values && typeof payload.values === 'object' ? Object.keys(payload.values) : names;
  return { filled: fields, count: fields.length };
}

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
  const safePayload = part.component === 'secure_form' ? redactSecureValues(payload) : (payload && typeof payload === 'object' ? payload : {});

  if (part.component === 'approval') {
    nextState = action === 'deny' ? 'denied' : 'approved';
    userText = action === 'deny' ? 'Neguei a ação.' : action === 'always' ? 'Permiti e pedi para sempre permitir.' : 'Permiti esta vez.';
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
  } else if (part.component === 'secure_form') {
    nextState = action === 'cancel' ? 'denied' : 'answered';
    userText = action === 'cancel'
      ? `Cancelei o formulário "${part.props.title}".`
      : `Preenchi o formulário "${part.props.title}" (${safePayload.count} campo${safePayload.count === 1 ? '' : 's'}). Os valores não entram nesta mensagem.`;
  } else if (part.component === 'draft_message') {
    if (action === 'edit' && typeof safePayload.body === 'string') {
      return {
        ok: true,
        part: { ...part, props: { ...part.props, body: String(safePayload.body).slice(0, 20000) } },
        userText: null,
        continue: false
      };
    }
    nextState = action === 'discard' ? 'denied' : 'answered';
    userText = action === 'discard' ? 'Descartei o rascunho.' : `Pode enviar o rascunho${part.props.to ? ` para ${part.props.to}` : ''}.`;
  } else if (part.component === 'slides') {
    const sample = (part.props.samples || []).find(s => s.id === safePayload.id);
    if (!sample) return { ok: false, error: 'amostra desconhecida' };
    userText = `Escolhi o visual "${sample.title}".`;
  } else if (part.component === 'setting') {
    nextState = action === 'dismiss' ? 'denied' : 'approved';
    userText = action === 'dismiss'
      ? `Mantive "${part.props.label}" como estava.`
      : `${part.props.proposed ? 'Ligue' : 'Desligue'} "${part.props.label}".`;
  }

  const updated = {
    ...part,
    state: nextState,
    action,
    payload: part.component === 'secure_form' ? safePayload : safePayload,
    decidedAt: Date.now()
  };
  return { ok: true, part: updated, userText, continue: true };
}

const uiLive = new Map(); // partId → { chatId, part }

export function rememberUiPart(chatId, part) {
  if (part?.id) uiLive.set(part.id, { chatId, part });
}

export function findUiPart(chat, partId) {
  for (const message of chat?.messages || []) {
    const step = (message.steps || []).find(s => s.kind === 'ui' && s.id === partId);
    if (step) return { message, step };
  }
  const live = uiLive.get(partId);
  if (live && live.chatId === chat?.id) {
    const message = [...(chat.messages || [])].reverse().find(m => m.role === 'assistant') || { steps: [live.part] };
    message.steps ||= [];
    if (!message.steps.some(s => s.id === partId)) message.steps.push(live.part);
    if (!chat.messages?.includes(message) && chat.messages) {
      // turno ainda não gravou a resposta: o cartão vive no mapa até o push
    }
    return { message, step: message.steps.find(s => s.id === partId) };
  }
  return null;
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
