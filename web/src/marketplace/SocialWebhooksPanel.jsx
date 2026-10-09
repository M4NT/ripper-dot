import { useState } from 'react';
import { api } from '../lib.js';
import { Icon, Switch, EmptyState, useConfirm } from '../ui.jsx';
import { useApp } from '../app.jsx';

function newHook() {
  return { id: crypto.randomUUID(), name: '', url: '', enabled: true };
}

export default function SocialWebhooksPanel() {
  const { S, refresh, toast } = useApp();
  const hooks = S.settings.social?.webhooks || [];
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function saveWebhooks(next) {
    setBusy(true);
    setErr('');
    try {
      await api('/api/settings', { method: 'PUT', body: { social: { webhooks: next } } });
      await refresh();
      toast('Webhooks sociais salvos');
      setDraft(null);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  function startAdd() {
    setDraft(newHook());
    setErr('');
  }

  async function commitDraft(e) {
    e.preventDefault();
    if (!draft.name.trim()) return setErr('Informe um nome.');
    if (!draft.url.trim() && !draft.hasUrl) return setErr('Informe a URL HTTPS do webhook.');
    const next = [...hooks.filter(h => h.id !== draft.id), draft];
    await saveWebhooks(next);
  }

  async function removeHook(id) {
    if (!(await confirm({ title: 'Remover este webhook?', danger: true, action: 'Remover' }))) return;
    await saveWebhooks(hooks.filter(h => h.id !== id));
  }

  async function toggleEnabled(hook, enabled) {
    await saveWebhooks(hooks.map(h => h.id === hook.id ? { ...h, enabled } : h));
  }

  const [confirm, confirmNode] = useConfirm();
  return (
    <>
      {confirmNode}
    <section className="set-card mp-social-hooks" aria-labelledby="social-hooks-title">
      <header>
        <h3 id="social-hooks-title">Webhooks sociais</h3>
        <p className="set-card-desc">
          Publicação leve via HTTP (ex.: Slack incoming webhook). O agente envia JSON <code>{'{ text }'}</code>.
          <strong> Cuidado:</strong> tokens e segredos na URL ficam armazenados localmente — não compartilhe a tela nem exporte backup sem necessidade.
        </p>
      </header>
      {hooks.length === 0 && !draft
        ? <EmptyState title="Nenhum webhook" body="Adicione um endereço HTTPS para o agente publicar rascunhos ou posts (com aprovação, conforme Segurança)." />
        : (
          <ul className="rows flat">
            {hooks.map(h => (
              <li key={h.id} className="row-item">
                <span className="thumb file-ico"><Icon name="share" size={18} /></span>
                <div className="row-main">
                  <b>{h.name}</b>
                  <small className="mono">{h.url || (h.hasUrl ? '••••' : 'sem URL')}</small>
                </div>
                <Switch checked={h.enabled !== false} onChange={v => toggleEnabled(h, v)} label={`Ativar ${h.name}`} />
                <button type="button" className="icon-btn sm" aria-label={`Remover ${h.name}`} disabled={busy} onClick={() => removeHook(h.id)}>
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      {draft && (
        <form className="mp-social-form" onSubmit={commitDraft}>
          <label className="field">Nome<input className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Slack #anúncios" maxLength={60} /></label>
          <label className="field">URL HTTPS<input className="input" type="url" value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} placeholder="https://hooks.slack.com/services/…" autoComplete="off" /></label>
          {err && <p className="form-error" role="alert">{err}</p>}
          <div className="set-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar webhook'}</button>
          </div>
        </form>
      )}
      {!draft && (
        <div className="set-actions">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={startAdd}><Icon name="plus" size={14} /> Adicionar webhook</button>
        </div>
      )}
    </section>
    </>
  );
}
