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
    if (st.status === 'error') throw new Error(st.error || 'Login OAuth falhou.');
  }
  throw new Error('Tempo esgotado aguardando o login OAuth.');
}
