import { api } from '../lib.js';

const MSG_TYPE = 'ripper-mcp-oauth';

function waitForOAuthResult(flowId, popup) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5 * 60_000;
    let timer;
    const finish = (ok, value) => {
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
      if (ok) resolve(value);
      else reject(value instanceof Error ? value : new Error(String(value)));
    };
    const onMsg = e => {
      if (!isTrustedOAuthEvent(e, popup, location.origin)) return;
      const d = e.data;
      if (d.status === 'complete') finish(true, d);
      else poll();
    };
    const poll = async () => {
      if (Date.now() > deadline) return finish(false, new Error('Tempo esgotado aguardando o login OAuth.'));
      const closed = !!(popup && popup.closed);
      try {
        const st = await api(`/api/mcp/oauth/status/${flowId}`);
        if (st.status === 'complete') return finish(true, st);
        if (st.status === 'error') {
          return finish(false, new Error(st.error || st.authStatus?.reason || 'Login OAuth falhou.'));
        }
      } catch (e) {
        if (e.status === 404) return finish(false, new Error('Fluxo OAuth expirado. Tente de novo.'));
      }
      if (closed) return finish(false, new Error('Janela de login fechada.'));
      timer = setTimeout(poll, 900);
    };
    window.addEventListener('message', onMsg);
    timer = setTimeout(poll, 400);
  });
}

export function isTrustedOAuthEvent(e, popup, origin) {
  if (!e || e.origin !== origin) return false;
  if (popup && e.source !== popup) return false;
  return !!(e.data && e.data.type === MSG_TYPE);
}

/** Abre o navegador do usuário e aguarda o callback no servidor Ripper (postMessage + polling). */
export async function runMcpOAuthLogin({ pluginName }) {
  const started = await api('/api/mcp/oauth/start', {
    method: 'POST',
    body: { pluginName }
  });
  const popup = window.open(started.authorizeUrl, 'ripper_mcp_oauth', 'width=520,height=720');
  if (!popup) {
    window.location.href = started.authorizeUrl;
  }
  return waitForOAuthResult(started.flowId, popup);
}

/** Tenta refresh_token no servidor; relança erro real da API. */
export async function refreshMcpOAuth(pluginName) {
  try {
    return await api('/api/mcp/oauth/refresh', { method: 'POST', body: { pluginName } });
  } catch (e) {
    throw new Error(e.message || 'Não foi possível atualizar o token OAuth.');
  }
}

export function authStatusLabel(st) {
  if (!st) return null;
  const map = {
    ok: 'Autenticado',
    expiring_soon: 'Token expira em breve',
    expired_refreshable: 'Token expirado',
    expired: 'Login expirado',
    needs_auth: 'Login necessário',
    lazy: 'Login sob demanda',
    none: null
  };
  return map[st.state] || st.reason || st.state;
}

export { MSG_TYPE as OAUTH_MESSAGE_TYPE, waitForOAuthResult };
