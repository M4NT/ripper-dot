/**
 * Mouse/teclado da VM: aprovação, teclas permitidas, digitação segura e trava
 * enquanto o usuário assume o controle no noVNC.
 */
import { effectiveApprovalPolicy, effectiveAutonomyLevel, normalizeAutonomyLevel } from './autonomy.mjs';
import { guardOutbound } from './x9-guard.mjs';

export const TYPE_MAX = 2000;
export const TYPE_CHUNK = 400;
export const TYPE_DELAY_MS = 12;
export const SCROLL_MAX = 20;
export const KEY_MAX = 8;
export const DEFAULT_GEOMETRY = { w: 1280, h: 800 };
export const USER_CONTROL_TTL_MS = 20_000;
export const USER_CONTROL_MSG = 'O usuário assumiu o controle da tela. Espere ele soltar (Soltar controle) para usar mouse e teclado.';
export const INPUT_DENIED = 'O usuário NÃO aprovou esta ação na tela da VM. Não tente contornar; explique o que precisava.';

const ALIAS = {
  enter: 'Return', return: 'Return', kp_enter: 'KP_Enter',
  tab: 'Tab', escape: 'Escape', esc: 'Escape',
  backspace: 'BackSpace', delete: 'Delete', del: 'Delete',
  space: 'space',
  left: 'Left', right: 'Right', up: 'Up', down: 'Down',
  home: 'Home', end: 'End', page_up: 'Page_Up', page_down: 'Page_Down',
  f5: 'F5', super: 'Super', super_l: 'Super_L', super_r: 'Super_R'
};
const MODS = { ctrl: 'ctrl', control: 'ctrl', alt: 'alt', shift: 'shift', super: 'super' };

const SAFE_NORM = new Set([
  'return', 'kp_enter', 'tab', 'escape', 'backspace', 'delete', 'space',
  'left', 'right', 'up', 'down', 'home', 'end', 'page_up', 'page_down', 'f5',
  'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z',
  'shift+tab', 'shift+left', 'shift+right', 'shift+up', 'shift+down', 'shift+home', 'shift+end'
]);

const DANGEROUS_NORM = new Set([
  'alt+f4', 'ctrl+alt+delete', 'ctrl+alt+del',
  'ctrl+q', 'ctrl+w', 'ctrl+shift+delete', 'ctrl+alt+backspace',
  'super', 'super_l', 'super_r',
  ...Array.from({ length: 12 }, (_, i) => `ctrl+alt+f${i + 1}`)
]);

function canonPart(p) {
  const s = String(p || '').trim();
  const low = s.toLowerCase();
  if (MODS[low]) return MODS[low];
  if (ALIAS[low]) return ALIAS[low];
  if (/^f([1-9]|1[0-2])$/i.test(s)) return `F${low.slice(1)}`;
  return s;
}

/** Teclas permitidas (e as perigosas, que só passam com aprovação). */
export function parseKeys(raw) {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error('keys não pode ser vazio.');
  if (tokens.length > KEY_MAX) throw new Error(`no máximo ${KEY_MAX} teclas por vez.`);
  return tokens.map(tok => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_+.-]*$/.test(tok)) {
      throw new Error('keys inválidas. Use nomes do xdotool, ex.: Return, Tab, ctrl+c.');
    }
    const parts = tok.split('+').map(canonPart);
    const normalized = parts.map(p => String(p).toLowerCase()).join('+');
    const xdo = parts.join('+');
    const dangerous = DANGEROUS_NORM.has(normalized);
    const safe = SAFE_NORM.has(normalized);
    if (!safe && !dangerous) {
      throw new Error(`tecla não permitida: ${tok}. Use Return, Tab, Escape, BackSpace, setas, ctrl+a/c/v/x/z, Page_Up/Down, Home/End, F5. Combinações como alt+F4 pedem aprovação.`);
    }
    return { token: tok, canonical: xdo, normalized, xdo, dangerous, safe };
  });
}

export function isDangerousKeys(raw) {
  try { return parseKeys(raw).some(k => k.dangerous); } catch { return false; }
}

export function typeContainsSubmit(text) {
  return /[\r\n]/.test(String(text ?? ''));
}

export function isSubmitKey(raw) {
  try {
    return parseKeys(raw).some(k => k.normalized === 'return' || k.normalized === 'kp_enter');
  } catch { return false; }
}

export function parseDisplayGeometry(out) {
  const m = /^(\d+)\s+(\d+)/.exec(String(out || '').trim());
  return m ? { w: +m[1], h: +m[2] } : null;
}

export function assertInGeometry(x, y, geo = DEFAULT_GEOMETRY) {
  const w = geo.w || DEFAULT_GEOMETRY.w;
  const h = geo.h || DEFAULT_GEOMETRY.h;
  const xi = Math.round(Number(x));
  const yi = Math.round(Number(y));
  if (!Number.isFinite(xi) || !Number.isFinite(yi) || xi < 0 || yi < 0 || xi >= w || yi >= h) {
    throw new Error(`coordenada fora da tela (${w}×${h}). x deve ser 0–${w - 1}, y 0–${h - 1}.`);
  }
  return { x: xi, y: yi, w, h };
}

export function scrollPlan(delta, name) {
  const v = Math.round(Number(delta));
  if (!Number.isFinite(v) || !v) return null;
  if (Math.abs(v) > 50) throw new Error(`${name} deve ser um inteiro entre -50 e 50.`);
  const asked = Math.abs(v);
  const n = Math.min(SCROLL_MAX, asked);
  const button = v > 0 ? (name === 'dx' ? '7' : '5') : (name === 'dx' ? '6' : '4');
  return { n, button, clipped: asked > SCROLL_MAX, asked };
}

export function typeTimeoutMs(len) {
  return Math.min(90_000, Math.max(8_000, Number(len) * TYPE_DELAY_MS + 5_000));
}

export function splitTypeText(text, chunk = TYPE_CHUNK) {
  const s = String(text);
  if (s.length <= chunk) return [s];
  const out = [];
  let i = 0;
  while (i < s.length) {
    if (s.length - i <= chunk) { out.push(s.slice(i)); break; }
    let end = i + chunk;
    const sp = s.lastIndexOf(' ', end);
    if (sp > i + Math.floor(chunk / 2)) end = sp + 1;
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}

/** Texto do cartão: o que vai ser digitado, com segredos mascarados. */
export function maskTypedPreview(text, knownSecrets = []) {
  const raw = String(text ?? '');
  const { text: masked, findings } = guardOutbound(raw, knownSecrets);
  const preview = masked.length > 500 ? `${masked.slice(0, 500)}…` : masked;
  return { preview, findings, submit: typeContainsSubmit(raw) };
}

export function computerInputLabel(kind, input = {}, { knownSecrets = [] } = {}) {
  if (kind === 'click') return `Clicar na tela da VM (${Math.round(input.x)}, ${Math.round(input.y)})`;
  if (kind === 'type') {
    const { preview, submit } = maskTypedPreview(input.text, knownSecrets);
    return `Digitar na tela da VM${submit ? ' (+ Return)' : ''}:\n${preview}`;
  }
  if (kind === 'key') return `Apertar tecla na VM: ${String(input.keys || input.key || '').trim()}`;
  if (kind === 'move') return `Mover o mouse da VM (${Math.round(input.x)}, ${Math.round(input.y)})`;
  if (kind === 'scroll') return `Rolar a tela da VM (${input.dy != null ? `dy=${input.dy}` : ''}${input.dx != null ? ` dx=${input.dx}` : ''})`.trim();
  return `Ação ${kind} na tela da VM`;
}

/**
 * Chave de “lembrar nesta conversa”.
 * Digitação + Return juntos não têm chave: lembrar isso contorna computer_exec.
 */
export function computerInputRememberKey(kind, input = {}, allowed = []) {
  if (kind === 'type') {
    if (typeContainsSubmit(input.text)) return null;
    if (allowedHasSubmit(allowed)) return null;
    return 'computer_type';
  }
  if (kind === 'key') {
    try {
      const parsed = parseKeys(input.keys || input.key);
      const danger = parsed.filter(k => k.dangerous);
      if (danger.length) return `computer_key:${danger.map(k => k.normalized).join(' ')}`;
      if (parsed.some(k => k.normalized === 'return' || k.normalized === 'kp_enter')) return null;
    } catch { /* parse falha depois, no xdotool */ }
    return 'computer_key';
  }
  return `computer_${kind}`;
}

function allowedHasSubmit(allowed) {
  return (allowed || []).some(k => k === 'computer_key:return' || k === 'computer_key:kp_enter');
}

export function computerInputRecordTarget(kind, input = {}) {
  if (kind === 'type') return `${String(input.text || '').length} caracteres`;
  if (kind === 'key') return String(input.keys || input.key || '').slice(0, 80);
  if (kind === 'click' || kind === 'move') return `${Math.round(input.x)},${Math.round(input.y)}`;
  if (kind === 'scroll') return `dy=${input.dy ?? 0},dx=${input.dx ?? 0}`;
  return kind;
}

/**
 * Precisa aprovar? { blocked } | { reason, command, rememberKey, rememberable } | { ok }.
 * Padrão: pede (sem classificador de alvo). fully_autonomous dispensa, salvo tecla perigosa.
 */
export function computerInputNeedsApproval({ kind, input = {}, agent, settings, policy, allowed = [], knownSecrets = [] }) {
  const level = settings ? effectiveAutonomyLevel(agent, settings) : normalizeAutonomyLevel(agent?.autonomyLevel);
  if (level === 'read_only') {
    return { blocked: true, message: 'Esta ação não é permitida (agente em modo somente leitura).' };
  }
  let dangerous = [];
  if (kind === 'key') {
    try { dangerous = parseKeys(input.keys || input.key).filter(k => k.dangerous); } catch { /* xdo valida */ }
  }
  const rememberKey = computerInputRememberKey(kind, input, allowed);
  const rememberable = rememberKey != null;
  const command = computerInputLabel(kind, input, { knownSecrets });
  const listed = rememberable && allowed.includes(rememberKey);

  if (dangerous.length && !listed) {
    return {
      reason: `combinação perigosa (${dangerous.map(k => k.canonical).join(', ')}): pode fechar a janela ou a sessão`,
      command,
      rememberKey,
      rememberable
    };
  }

  const effective = policy || effectiveApprovalPolicy(agent, 'risky', settings);
  if ((effective === 'never' || level === 'fully_autonomous') && !dangerous.length) return { ok: true };
  if (listed) return { ok: true };
  return {
    reason: 'ação na tela da VM (mouse/teclado). Sem alvo textual: precisa da sua aprovação.',
    command,
    rememberKey,
    rememberable
  };
}

const userControl = new Map();

function liveLock(agentId, now) {
  const id = String(agentId || '');
  const cur = userControl.get(id);
  if (!cur) return null;
  if (cur.expiresAt <= now) {
    userControl.delete(id);
    return null;
  }
  return cur;
}

export function userScreenControlState(agentId, now = Date.now()) {
  const cur = liveLock(agentId, now);
  return cur ? { control: true, owner: cur.owner, expiresAt: cur.expiresAt } : { control: false };
}

/**
 * Trava “Assumir controle”: dono + expiração.
 * Outro dono não solta a trava (fechar MiniScreen não libera a do LiveScreen).
 * Sem heartbeat o prazo vence e o agente não fica preso se a aba fechou.
 */
export function setUserScreenControl(agentId, on, owner, now = Date.now()) {
  const id = String(agentId || '');
  if (!id) return { control: false };
  const cur = liveLock(id, now);
  if (on) {
    if (cur && owner && cur.owner && cur.owner !== String(owner)) {
      return { control: true, owner: cur.owner, expiresAt: cur.expiresAt, conflict: true };
    }
    const next = {
      owner: owner ? String(owner) : (cur?.owner || 'anon'),
      expiresAt: now + USER_CONTROL_TTL_MS
    };
    userControl.set(id, next);
    return { control: true, ...next };
  }
  if (!cur) return { control: false };
  if (owner && cur.owner && cur.owner !== String(owner)) {
    return { control: true, owner: cur.owner, expiresAt: cur.expiresAt };
  }
  userControl.delete(id);
  return { control: false };
}

export function isUserScreenControl(agentId, now = Date.now()) {
  return !!liveLock(agentId, now);
}

export function displayQueueKey(agentId) {
  return `display:${agentId || 'unknown'}`;
}

const queues = new Map();
export function serializeCall(key, fn) {
  const run = Promise.resolve(queues.get(key)).catch(() => {}).then(fn);
  queues.set(key, run.then(() => {}, () => {}));
  return run;
}

/** Fila única do display :99 — mouse/teclado da VM e browser_* não se atravessam. */
export function serializeDisplay(agentId, fn) {
  return serializeCall(displayQueueKey(agentId), fn);
}

export function wrapDisplaySession(actions, agentId) {
  if (!actions) return actions;
  const wrap = fn => (...args) => serializeDisplay(agentId, async () => {
    if (isUserScreenControl(agentId)) return USER_CONTROL_MSG;
    return fn(...args);
  });
  const out = { ...actions };
  for (const name of Object.keys(actions)) {
    if (typeof actions[name] === 'function') out[name] = wrap(actions[name]);
  }
  return out;
}

const typeRecent = new Map();

export function typeRequestKey(scope, requestId) {
  const id = String(requestId || '').trim();
  if (!id) return null;
  return `${scope}:${id}`;
}

/**
 * Anti-duplicação por id da requisição (tool_use / requestId), não por texto.
 * Falha antes de marcar a digitação não impede retry do mesmo id.
 */
export async function withTypeIdempotency(scope, requestId, fn) {
  const key = typeRequestKey(scope, requestId);
  if (!key) return fn({ markTyped() {} });

  const hit = typeRecent.get(key);
  if (hit?.pending) return hit.pending;
  if (hit?.typed) {
    return hit.failed
      ? 'A digitação anterior desta requisição pode ter saído pela metade e foi interrompida. Não vou repetir agora para não duplicar. Confira a tela.'
      : 'ok (já digitado nesta requisição; não repeti para não duplicar)';
  }

  let typed = false;
  const markTyped = () => { typed = true; };
  const pending = Promise.resolve()
    .then(() => fn({ markTyped }))
    .then(r => {
      typeRecent.set(key, { typed: true, at: Date.now(), result: r });
      return r;
    }, e => {
      if (typed) typeRecent.set(key, { typed: true, failed: true, at: Date.now() });
      else typeRecent.delete(key);
      throw e;
    });
  typeRecent.set(key, { pending });
  return pending;
}

export async function runGuardedInput(kind, input, computer, opts) {
  const agentId = opts.agentId || opts.agent?.id;
  if (agentId && isUserScreenControl(agentId)) return USER_CONTROL_MSG;
  const allowed = typeof opts.allowed === 'function' ? opts.allowed() : (opts.allowed || []);
  const decision = computerInputNeedsApproval({
    kind, input, agent: opts.agent, settings: opts.settings, policy: opts.policy, allowed,
    knownSecrets: opts.knownSecrets || []
  });
  if (decision.blocked) return decision.message;
  let approved = 'rule';
  if (decision.reason) {
    const ok = await opts.ask(decision.command, decision.reason, decision.rememberKey, {
      rememberable: decision.rememberable !== false
    });
    if (!ok) return INPUT_DENIED;
    approved = 'user';
  }
  try {
    const out = await computer[kind](input);
    opts.record?.({
      target: computerInputRecordTarget(kind, input),
      approved,
      ok: true
    });
    return out;
  } catch (e) {
    opts.record?.({
      target: computerInputRecordTarget(kind, input),
      approved,
      ok: false,
      error: e.message
    });
    throw e;
  }
}

export function wrapComputerInput(computer, opts) {
  if (!computer) return computer;
  const extra = {};
  for (const kind of ['click', 'type', 'key', 'move', 'scroll']) {
    if (typeof computer[kind] !== 'function') continue;
    extra[kind] = a => runGuardedInput(kind, a, computer, opts);
  }
  return { ...computer, ...extra };
}

export function _resetComputerInputForTests() {
  userControl.clear();
  queues.clear();
  typeRecent.clear();
}
