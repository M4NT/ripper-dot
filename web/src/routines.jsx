// Rotinas: quando algo acontece (horário, webhook, e-mail, WhatsApp), um agente — ou um fluxo inteiro — entra em ação.
// Usado na aba Rotinas do agente e no botão "Automatizar" de cada fluxo.
import { useState } from 'react';
import { useApp } from './app.jsx';
import { api, fmtAgo } from './lib.js';
import { Icon, Select, Switch } from './ui.jsx';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SCOPE = { contacts: 'de contatos', groups: 'em grupos', any: 'de contatos ou grupos' };
const STATUS = { running: 'Em andamento', succeeded: 'Com novidade', failed: 'Falhou', quiet: 'Sem novidade (silenciosa)', never: 'Ainda não rodou' };
const quote = k => `“${k.join('”, “')}”`;

export function describeTrigger(r) {
  if (r.trigger === 'email') return `Quando chegar e-mail${r.keywords?.length ? ` de/sobre ${quote(r.keywords)}` : ''}`;
  if (r.trigger === 'whatsapp') return `Mensagem no WhatsApp ${SCOPE[r.scope] || SCOPE.contacts}${r.keywords?.length ? ` com ${quote(r.keywords)}` : ''}`;
  if (r.trigger === 'github') return 'Eventos do GitHub';
  if (r.trigger === 'webhook') return `Quando chegar um evento${r.hasSecret ? ' · assinatura verificada' : ''}`;
  if (r.everyMinutes) return `A cada ${r.everyMinutes} min`;
  return `${r.weekday != null ? DAYS[r.weekday] + ', ' : 'Todo dia, '}${r.dailyAt}`;
}
const triggerIcon = r => ({ webhook: 'plug', whatsapp: 'chat', email: 'inbox', github: 'plug' })[r.trigger] || 'clock';

export function RoutineList({ list }) {
  const { refresh, toast } = useApp();
  const hookUrl = r => `${location.origin}/api/hooks/${r.hookToken}`;
  if (!list.length) return null;
  return (
    <ul className="rows">{list.map(r => (
      <li key={r.id} className="row-item routine-row">
        <span className="thumb file-ico"><Icon name={triggerIcon(r)} size={18} /></span>
        <div className="row-main">
          <b>{r.name}{r.quiet !== false && <span className="tag">só novidades</span>}</b>
          <small>{describeTrigger(r)}{r.prompt ? ` · ${r.prompt}` : ''}</small>
          {r.trigger === 'webhook' && (
            <div className="hook-url"><code>{hookUrl(r)}</code><button type="button" className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(hookUrl(r)); toast('Endereço copiado'); }}><Icon name="copy" size={13} />Copiar</button></div>
          )}
          {r.lastRun > 0 && <small>Última execução: {fmtAgo(r.lastRun)} · {STATUS[r.lastStatus] || 'Sem resultado'}{r.lastError ? ` · ${r.lastError}` : ''}{r.lastChatId && r.lastStatus !== 'quiet' && <> · <a className="link" href={`#/c/${r.lastChatId}`}>ver resultado</a></>}</small>}
        </div>
        <button type="button" className="icon-btn sm" aria-label={`Remover ${r.name}`} onClick={() => api(`/api/routines/${r.id}`, { method: 'DELETE' }).then(refresh)}><Icon name="trash" size={16} /></button>
      </li>
    ))}</ul>
  );
}

/** flow: { id, name } quando a rotina dispara um fluxo (o "o que fazer" vira contexto opcional). */
export function RoutineForm({ agentId, flow, onDone }) {
  const { S, refresh, toast } = useApp();
  const blank = { name: flow ? flow.name : '', prompt: '', kind: 'daily', when: '08:00', weekday: '', quiet: !flow, secret: '', keywords: '', scope: 'contacts' };
  const [f, setF] = useState(blank);
  const waOn = !!S.settings.whatsappWeb?.agentId || !!S.settings.whatsappWeb?.enabled;
  async function add() {
    if (!flow && !f.prompt.trim()) return toast('Diga o que a rotina deve fazer.', 'error');
    const when = f.kind === 'webhook' ? { trigger: 'webhook', hookSecret: f.secret || undefined }
      : f.kind === 'whatsapp' ? { trigger: 'whatsapp', keywords: f.keywords, scope: f.scope }
      : f.kind === 'email' ? { trigger: 'email', keywords: f.keywords }
      : f.kind === 'every' ? { everyMinutes: +f.when || 60 } : { dailyAt: f.when, weekday: f.weekday === '' ? undefined : +f.weekday };
    try {
      await api('/api/routines', { method: 'POST', body: { agentId, ...(flow ? { flowId: flow.id } : {}), name: f.name || 'Rotina', prompt: f.prompt, quiet: f.quiet, ...when } });
    } catch (e) { return toast(e.message, 'error'); }
    setF(blank); refresh(); toast(f.kind === 'webhook' ? 'Pronto. Copie o endereço do webhook na lista.' : flow ? 'Fluxo automatizado' : 'Rotina criada');
    onDone?.();
  }
  const ph = { email: 'Resuma o e-mail e, se for de cliente, rascunhe uma resposta.', whatsapp: 'Me avise na Caixa com quem mandou e o que precisa.', webhook: 'Leia o evento. Se for um PR novo, resuma as mudanças e aponte riscos.' }[f.kind] || 'Pesquise as notícias de IA de hoje e me mande um resumo.';
  return (
    <div className="card-form">
      <h3 className="sub">{flow ? 'Quando rodar este fluxo' : 'Nova rotina'}</h3>
      <label className="field">Nome<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'webhook' ? 'Revisar PRs' : 'Resumo de IA'} /></label>
      <label className="field">{flow ? 'Contexto extra (opcional)' : 'O que fazer'}<textarea rows={flow ? 2 : 3} value={f.prompt} onChange={e => setF({ ...f, prompt: e.target.value })} placeholder={flow ? 'Ex.: foque em clientes de São Paulo. O evento (e-mail, mensagem…) já chega ao fluxo sozinho.' : ph} /></label>
      <div className="row wrap-row">
        <Select label="Quando" value={f.kind} onChange={kind => setF({ ...f, kind, when: kind === 'every' ? '60' : '08:00' })}
          options={[{ value: 'daily', label: 'No horário', icon: <Icon name="clock" size={15} /> }, { value: 'every', label: 'A cada N minutos', icon: <Icon name="retry" size={15} /> }, { value: 'webhook', label: 'Quando chegar um evento', hint: 'Webhook: GitHub, formulários, qualquer sistema', icon: <Icon name="plug" size={15} /> }, ...(S.settings.email?.enabled ? [{ value: 'email', label: 'Quando chegar e-mail', hint: 'Com palavras-chave no remetente ou assunto', icon: <Icon name="inbox" size={15} /> }] : []), ...(waOn ? [{ value: 'whatsapp', label: 'Quando chegar mensagem no WhatsApp', hint: 'Com palavras-chave, de contatos ou grupos', icon: <Icon name="chat" size={15} /> }] : [])]} />
        {f.kind === 'daily' && <Select label="Dia" value={f.weekday} onChange={weekday => setF({ ...f, weekday })}
          options={[{ value: '', label: 'Todo dia' }, ...DAYS.map((d, i) => ({ value: String(i), label: d }))]} />}
        {(f.kind === 'daily' || f.kind === 'every') && <input className="input narrow-input" type={f.kind === 'daily' ? 'time' : 'number'} min={5} value={f.when} onChange={e => setF({ ...f, when: e.target.value })} aria-label={f.kind === 'daily' ? 'Horário' : 'Minutos'} />}
      </div>
      {f.kind === 'email' && <label className="field">Palavras-chave<input value={f.keywords} onChange={e => setF({ ...f, keywords: e.target.value })} placeholder="fatura, cliente@empresa.com, proposta" /><small>Valem para o remetente e o assunto. Vazio = todo e-mail novo. Responder sempre pede a sua aprovação.</small></label>}
      {f.kind === 'whatsapp' && <>
        <label className="field">Palavras-chave<input value={f.keywords} onChange={e => setF({ ...f, keywords: e.target.value })} placeholder="urgente, orçamento, nota fiscal" /><small>Separe por vírgula. Vale sem acento e sem diferença de maiúscula. Vazio = toda mensagem. Áudios transcritos também contam.</small></label>
        <Select label="De onde" value={f.scope} onChange={scope => setF({ ...f, scope })}
          options={[{ value: 'contacts', label: 'Contatos' }, { value: 'groups', label: 'Grupos', hint: 'Precisa de “Ler grupos” ligado. O agente nunca responde no grupo.' }, { value: 'any', label: 'Contatos e grupos' }]} />
      </>}
      {f.kind === 'webhook' && <label className="field">Segredo do webhook (opcional)<input value={f.secret} onChange={e => setF({ ...f, secret: e.target.value })} placeholder="O mesmo “Secret” configurado no GitHub" /><small>Com segredo, eventos sem a assinatura correta (X-Hub-Signature-256) são recusados.</small></label>}
      {!flow && <label className="switch-row"><span><b>Só avisar se houver novidade</b><small>Sem nada relevante, a execução não deixa conversa nem notificação.</small></span><Switch checked={f.quiet} onChange={quiet => setF({ ...f, quiet })} label="Só avisar se houver novidade" /></label>}
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={add}><Icon name={flow ? 'bolt' : 'plus'} size={16} />{flow ? 'Automatizar' : 'Criar rotina'}</button>
        {onDone && <button type="button" className="btn" onClick={onDone}>Cancelar</button>}
      </div>
    </div>
  );
}
