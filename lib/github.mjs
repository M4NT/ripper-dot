// GitHub para o Guardião: API REST com token do usuário (fine-grained ou clássico).
// Consulta periódica em vez de webhook: funciona atrás de qualquer roteador, sem expor o Ripper.

const API = process.env.GITHUB_API_URL || 'https://api.github.com'; // override só para testes

export const githubReady = g => !!(g?.token && g.repos?.length);

/** "https://github.com/a/b", "a/b", "a/b.git" → "a/b" (ou null). */
export function normalizeRepo(v) {
  const m = /(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(v || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function gh(g, path, { method = 'GET', body, accept } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${g.token}`, accept: accept || 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'ripper', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(() => { try { return JSON.parse(text).message; } catch { return text.slice(0, 200); } })()}`);
  if (accept?.includes('diff')) return text;
  return text ? JSON.parse(text) : null;
}

/**
 * O que mudou desde `since` num repositório: PRs abertos/atualizados, issues novas, checks que falharam
 * no último commit do branch padrão. Ignora o que o próprio dono do token fez (não acorda por si mesmo).
 */
export async function repoChanges(g, repo, since, me) {
  const iso = new Date(since).toISOString();
  const out = [];
  const issues = await gh(g, `/repos/${repo}/issues?state=open&since=${iso}&sort=updated&per_page=30`);
  for (const i of issues || []) {
    if (Date.parse(i.updated_at) <= since || i.user?.login === me) continue;
    const isPr = !!i.pull_request;
    const isNew = Date.parse(i.created_at) > since;
    out.push({ kind: isPr ? (isNew ? 'pr.opened' : 'pr.updated') : (isNew ? 'issue.opened' : 'issue.updated'), repo, number: i.number, title: i.title, author: i.user?.login, url: i.html_url, body: String(i.body || '').slice(0, 1500) });
  }
  const r = await gh(g, `/repos/${repo}`);
  const runs = await gh(g, `/repos/${repo}/actions/runs?branch=${encodeURIComponent(r.default_branch)}&status=failure&per_page=5`).catch(() => null);
  for (const run of runs?.workflow_runs || []) {
    if (Date.parse(run.updated_at) <= since) continue;
    out.push({ kind: 'ci.failed', repo, number: run.run_number, title: `${run.name} falhou em ${r.default_branch}`, author: run.actor?.login, url: run.html_url, body: `Commit: ${run.head_commit?.message?.split('\n')[0] || run.head_sha}` });
  }
  return out;
}

/** Texto do evento para a rotina do Guardião. */
export function describeChange(c) {
  const what = { 'pr.opened': 'PR aberto', 'pr.updated': 'PR atualizado', 'issue.opened': 'Issue nova', 'issue.updated': 'Issue atualizada', 'ci.failed': 'CI falhou' }[c.kind] || c.kind;
  return `${what} em ${c.repo} #${c.number}: ${c.title}\nPor: ${c.author || '?'}\n${c.url}${c.body ? `\n\n${c.body}` : ''}`;
}
