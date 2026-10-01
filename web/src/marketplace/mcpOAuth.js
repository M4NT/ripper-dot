import { api } from '../lib.js';

/** Abre o navegador do usuário e aguarda o callback no servidor Ripper. */
export async function runMcpOAuthLogin({ pluginName, url, discovery }) {
  const started = await api('/api/mcp/oauth/start', {
    method: 'POST',
    body: { pluginName, url, discovery }
  });
  const popup = window.open(started.authorizeUrl, 'ripper_mcp_oauth', 'width=520,height=720');
  if (!popup) {
    window.location.href = started.authorizeUrl;
  }
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1200));
    const st = await api(`/api/mcp/oauth/status/${started.flowId}`);
    if (st.status === 'complete') return st;
    if (st.status === 'error') {
      const detail = st.error || st.authStatus?.reason || 'Login OAuth falhou.';
      throw new Error(detail);
    }
  }
  throw new Error('Tempo esgotado aguardando o login OAuth.');
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
