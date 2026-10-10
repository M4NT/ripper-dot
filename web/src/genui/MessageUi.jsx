import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib.js';
import { parseGenuiFence, presentGenui } from '../../../lib/genui.mjs';
import { GenUiView } from './registry.jsx';
import { chatIdFromLocation, getGenUiHost } from './host.js';
import '../styles/telas/genui.css';

async function runAction(part, action, payload) {
  const host = getGenUiHost();
  const chatId = part.chatId || host.chatId || chatIdFromLocation();
  if (chatId) {
    const r = await api(`/api/chats/${chatId}/ui-actions`, { method: 'POST', body: { partId: part.id, action, payload } });
    if (r?.text && host.send) host.send(r.text);
    return r;
  }
  if (host.send) {
    const label = action === 'submit' && payload?.selected
      ? `Escolhi: ${(payload.selected || []).join(', ')}${payload.other ? ', ' + payload.other : ''}`
      : `Ação do cartão: ${action}`;
    host.send(label);
  }
}

export function GenUiCard({ part, live }) {
  const [local, setLocal] = useState(part);
  const cur = local?.id === part.id ? { ...part, ...local, props: local.props || part.props } : part;
  async function onAction(action, payload) {
    if (action === 'edit') {
      setLocal(p => ({ ...(p || part), props: { ...(p || part).props, ...payload } }));
      return;
    }
    try {
      const r = await runAction(cur, action, payload);
      if (r?.needsConfirm) {
        setLocal(p => ({ ...(p || part), ...(r.part || {}), state: 'input-available' }));
        return;
      }
      if (r?.part) setLocal(r.part);
      else setLocal(p => ({ ...(p || part), state: action === 'deny' || action === 'cancel' || action === 'discard' || action === 'dismiss' ? 'denied' : 'answered' }));
    } catch {
      setLocal(p => ({ ...(p || part), state: 'output-error', error: 'Não consegui registrar a escolha.' }));
    }
  }
  return <GenUiView part={cur} live={live} onAction={onAction} />;
}

export function GenUiSteps({ steps, live }) {
  const parts = (steps || []).filter(s => s.kind === 'ui');
  if (!parts.length) return null;
  return (
    <div className="oui-stack">
      {parts.map(p => <GenUiCard key={p.id} part={p} live={live} />)}
    </div>
  );
}

export function GenUiFence({ code, live, chatId }) {
  const hostId = chatId || getGenUiHost().chatId || chatIdFromLocation();
  const shown = useMemo(() => {
    const parsed = parseGenuiFence(code, { live });
    if (parsed.part) return parsed.part;
    if (parsed.fallback && parsed.text) return { id: 'fence', kind: 'ui', component: 'data_table', props: {}, state: 'output-error', error: parsed.warning, chatId: hostId };
    return presentGenui({ component: 'progress', props: { steps: [{ title: 'Montando…', status: 'running' }, { title: 'Pronto', status: 'pending' }] }, partial: true }).part;
  }, [code, live, hostId]);
  const [registered, setRegistered] = useState(null);
  useEffect(() => {
    if (live || !hostId || !shown?.component || shown.state === 'input-streaming' || shown.state === 'output-error') return;
    let cancelled = false;
    api(`/api/chats/${hostId}/ui-parts`, { method: 'POST', body: { fence: code } })
      .then(r => { if (!cancelled && r?.part) setRegistered(r.part); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [code, live, hostId, shown?.component, shown?.state]);
  const part = registered || { ...shown, chatId: shown.chatId || hostId };
  return <GenUiCard part={part} live={live} />;
}
