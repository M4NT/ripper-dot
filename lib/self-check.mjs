// Checagens noturnas (opt-in em settings.checks): smoke diário e auditoria barata de capacidades.
import { listRipperBuiltinToolNames } from './ripper-builtin-tools.mjs';

/** Dia local (AAAA-MM-DD) se a checagem `kind` está ligada e ainda não rodou hoje depois da hora; senão null. */
export function checkDue(settings, kind, lastDay, now = new Date()) {
  const c = settings?.checks || {};
  if (c[kind] !== true) return null;
  const day = now.toLocaleDateString('sv');
  return day !== lastDay && now.getHours() >= (c.hour ?? 3) ? day : null;
}

/**
 * Auditoria sem tokens: cada área que passou na última auditoria real (docs/capacidades.json)
 * ainda tem as ferramentas Ripper que usou? Ferramentas do SDK (WebFetch…) e MCP (mcp__…) ficam de fora.
 */
export function capabilityGaps(cap) {
  const all = new Set(listRipperBuiltinToolNames({ tools: ['browser', 'memory', 'routines', 'computer', 'web', 'social'] }, { computer: { mode: 'docker' } }));
  const gaps = [];
  for (const r of cap?.results || []) {
    if (!r.pass) { gaps.push(`${r.area}: falhou na última auditoria`); continue; }
    const missing = (r.tools || []).filter(t => !/^(mcp__|[A-Z])/.test(t) && !all.has(t));
    if (missing.length) gaps.push(`${r.area}: sumiu ${missing.join(', ')}`);
  }
  return gaps;
}
