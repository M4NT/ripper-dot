import { useMemo, useState } from 'react';
import { Icon } from '../ui.jsx';
import { GENUI_CATALOG } from '../../../lib/genui-catalog.mjs';
import { genuiToText } from '../../../lib/genui.mjs';
import { Badge, Button, Card, Field, FallbackText, Skeleton, Tabs, cardStatus, cn } from './shell.jsx';

const locked = state => state && !['input-available', 'input-streaming'].includes(state);

function Head({ icon, title, extra }) {
  return (
    <header className="oui-head">
      <span className="oui-ico"><Icon name={icon} size={15} /></span>
      <b className="oui-title">{title}</b>
      {extra}
    </header>
  );
}

function Actions({ children }) {
  return <div className="oui-actions">{children}</div>;
}

function Receipt({ state, text }) {
  if (!state || state === 'input-available' || state === 'input-streaming') return null;
  const ok = state === 'answered' || state === 'approved';
  return <p className={cn('oui-receipt', ok ? 'ok' : 'err')}><Icon name={ok ? 'check' : 'x'} size={13} />{text}</p>;
}

export function ApprovalView({ props, state, onAction }) {
  const [open, setOpen] = useState(false);
  const disabled = locked(state);
  return (
    <Card status={cardStatus(state)} className={cn('oui-approval', props.destructive && 'destructive')} role="group" aria-label={props.title}>
      <Head icon="alert" title="Revisar uma ação" extra={props.destructive && <Badge tone="err">destrutiva</Badge>} />
      <p className="oui-lead">{props.title}</p>
      {props.reason && <p className="oui-muted">{props.reason}</p>}
      {(props.details || props.command) && (
        <details className="oui-details" open={open} onToggle={e => setOpen(e.target.open)}>
          <summary>Ver o pedido completo</summary>
          {props.command && <pre className="oui-cmd">{props.command}</pre>}
          {props.details && <p>{props.details}</p>}
        </details>
      )}
      {!disabled && (
        <Actions>
          <Button variant="default" onClick={() => onAction('allow')}>{props.allowOnceLabel || 'Permitir uma vez'}</Button>
          <Button variant="secondary" onClick={() => onAction('always')}>{props.alwaysLabel || 'Sempre permitir'}</Button>
          <Button variant="destructive" onClick={() => onAction('deny')}>{props.denyLabel || 'Negar'}</Button>
        </Actions>
      )}
      <Receipt state={state} text={state === 'denied' ? 'Você negou' : state === 'approved' ? 'Você permitiu' : 'Sem resposta'} />
    </Card>
  );
}

export function QuestionView({ props, state, onAction }) {
  const [sel, setSel] = useState(() => new Set());
  const [other, setOther] = useState('');
  const disabled = locked(state);
  function toggle(id) {
    setSel(prev => {
      const next = new Set(props.multiple ? prev : []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const canSubmit = sel.size > 0 || (props.allowOther && other.trim());
  return (
    <Card status={cardStatus(state)} role="group" aria-label={props.prompt}>
      <Head icon="chat" title="Pergunta" />
      <p className="oui-lead">{props.prompt}</p>
      <div className="oui-options" role={props.multiple ? 'group' : 'radiogroup'}>
        {(props.options || []).map(o => (
          <button key={o.id} type="button" role={props.multiple ? 'checkbox' : 'radio'} aria-checked={sel.has(o.id)} className={cn('oui-option', sel.has(o.id) && 'on')} disabled={disabled} onClick={() => toggle(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      {props.allowOther && !disabled && (
        <Field label="Outro">
          <input className="input" value={other} onChange={e => setOther(e.target.value)} placeholder="Escreva a sua opção" />
        </Field>
      )}
      {!disabled && <Actions><Button variant="default" disabled={!canSubmit} onClick={() => onAction('submit', { selected: [...sel], other: other.trim() })}>{props.submitLabel || 'Enviar'}</Button></Actions>}
      <Receipt state={state} text="Respondida" />
    </Card>
  );
}

export function ConnectAppView({ props, state, onAction }) {
  const disabled = locked(state);
  const tone = props.status === 'connected' ? 'ok' : props.status === 'error' ? 'err' : props.status === 'reauth' ? 'warn' : 'neutral';
  const label = { idle: 'não conectado', connected: 'conectado', reauth: 'reautorizar', error: 'erro' }[props.status || 'idle'];
  return (
    <Card status={cardStatus(state)} role="group" aria-label={`Conectar ${props.app}`}>
      <Head icon="plug" title="Conectar app" extra={<Badge tone={tone}>{label}</Badge>} />
      <div className="oui-app">
        {props.logo ? <img src={props.logo} alt="" width={36} height={36} /> : <span className="oui-app-fallback">{(props.app || '?')[0]}</span>}
        <div><b>{props.app}</b>{props.reason && <p className="oui-muted">{props.reason}</p>}</div>
      </div>
      {props.scopes?.length > 0 && <p className="oui-muted">Permissões: {props.scopes.join(', ')}</p>}
      {props.error && <p className="oui-warn">{props.error}</p>}
      {!disabled && (
        <Actions>
          <Button variant="default" onClick={() => onAction(props.status === 'error' ? 'retry' : 'connect')}>{props.status === 'reauth' ? 'Reautorizar' : props.status === 'error' ? 'Tentar de novo' : 'Conectar'}</Button>
          <Button variant="ghost" onClick={() => onAction('cancel')}>Agora não</Button>
        </Actions>
      )}
      <Receipt state={state} text={state === 'denied' ? 'Cancelado' : 'Conectado — o agente continua'} />
    </Card>
  );
}

export function SecureFormView({ props, state, onAction }) {
  const [values, setValues] = useState({});
  const disabled = locked(state);
  const missing = (props.fields || []).some(f => f.required && !String(values[f.name] || '').trim());
  return (
    <Card status={cardStatus(state)} role="form" aria-label={props.title}>
      <Head icon="key" title={props.title} extra={props.site && <Badge>{props.site}</Badge>} />
      <p className="oui-muted">Os valores não entram no histórico do agente.</p>
      {!disabled && (props.fields || []).map(f => (
        <Field key={f.name} label={f.label}>
          <input className="input" name={f.name} type={f.type || 'text'} autoComplete="off" required={!!f.required} value={values[f.name] || ''} onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))} />
        </Field>
      ))}
      {!disabled && (
        <Actions>
          <Button variant="default" disabled={missing} onClick={() => onAction('submit', { values })}>{props.submitLabel || 'Enviar'}</Button>
          <Button variant="ghost" onClick={() => onAction('cancel')}>Cancelar</Button>
        </Actions>
      )}
      <Receipt state={state} text={state === 'denied' ? 'Cancelado' : 'Enviado (valores omitidos)'} />
    </Card>
  );
}

export function DraftMessageView({ props, state, onAction }) {
  const [body, setBody] = useState(props.body || '');
  const disabled = locked(state);
  return (
    <Card status={cardStatus(state)} role="group" aria-label="Rascunho">
      <Head icon="share" title={`Rascunho · ${props.channel}`} />
      {props.to && <p className="oui-muted">Para {props.to}</p>}
      {props.subject && <p className="oui-lead">{props.subject}</p>}
      {disabled ? <pre className="oui-body">{props.body}</pre> : (
        <textarea className="input oui-draft" rows={6} value={body} onChange={e => setBody(e.target.value)} aria-label="Corpo do rascunho" />
      )}
      {!disabled && (
        <Actions>
          <Button variant="default" onClick={() => onAction('send', { body })}>{props.sendLabel || 'Enviar'}</Button>
          <Button variant="secondary" onClick={() => onAction('edit', { body })}>Guardar edição</Button>
          <Button variant="ghost" onClick={() => onAction('discard')}>Descartar</Button>
        </Actions>
      )}
      <Receipt state={state} text={state === 'denied' ? 'Descartado' : 'Pode enviar'} />
    </Card>
  );
}

function copy(text, btn, label) {
  navigator.clipboard.writeText(text);
  const el = btn;
  const prev = el.textContent;
  el.textContent = 'Copiado';
  setTimeout(() => { el.textContent = prev || label; }, 1400);
}

export function DataTableView({ props }) {
  const [sort, setSort] = useState({ key: props.columns?.[0]?.key, dir: 1 });
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const keys = (props.columns || []).map(c => c.key);
    let list = [...(props.rows || [])];
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      list = list.filter(r => keys.some(k => String(r?.[k] ?? '').toLowerCase().includes(n)));
    }
    list.sort((a, b) => {
      const av = a?.[sort.key], bv = b?.[sort.key];
      if (av == null && bv == null) return 0;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv), 'pt-BR') * sort.dir;
    });
    return list;
  }, [props.rows, props.columns, sort, q]);
  const md = genuiToText('data_table', { ...props, rows });
  const csv = [props.columns.map(c => c.label).join(';'), ...rows.map(r => props.columns.map(c => String(r?.[c.key] ?? '')).join(';'))].join('\n');
  return (
    <Card padded={false} className="oui-table-card">
      <div className="oui-table-bar">
        <Head icon="data" title={props.title || 'Tabela'} />
        <input className="input oui-filter" value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrar…" aria-label="Filtrar tabela" />
        <button type="button" className="link" onClick={e => copy(md, e.currentTarget, 'Markdown')}>Copiar Markdown</button>
        <button type="button" className="link" onClick={e => copy(csv, e.currentTarget, 'CSV')}>Copiar CSV</button>
      </div>
      <div className="oui-table-scroll">
        <table className="oui-table">
          <thead>
            <tr>
              {(props.columns || []).map(c => (
                <th key={c.key} scope="col">
                  <button type="button" className="oui-th" onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 }))}>
                    {c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {(props.columns || []).map(c => {
                  const v = r?.[c.key];
                  if (c.type === 'link' && v) return <td key={c.key}><a href={String(v)} target="_blank" rel="noopener noreferrer">{String(v)}</a></td>;
                  if (c.type === 'status') return <td key={c.key}><Badge tone={/ok|pronto|open|merged/i.test(String(v)) ? 'ok' : /fail|erro|closed/i.test(String(v)) ? 'err' : 'neutral'}>{String(v ?? '')}</Badge></td>;
                  return <td key={c.key} className={c.type === 'number' ? 'num' : undefined}>{v == null ? '' : String(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.caption && <p className="oui-caption">{props.caption}</p>}
    </Card>
  );
}

export function ChartView({ props }) {
  const labels = props.labels || [];
  const series = props.series || [];
  const all = series.flatMap(s => s.values || []);
  const max = Math.max(1, ...all);
  const w = 360, h = 160, pad = 28;
  const n = Math.max(1, labels.length);
  return (
    <Card>
      <Head icon="data" title={props.title || 'Gráfico'} extra={<Badge>{props.kind}</Badge>} />
      {props.kind === 'pie' ? (
        <Pie labels={labels} values={series[0]?.values || []} />
      ) : (
        <svg className="oui-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={props.title || 'Gráfico'}>
          {series.map((s, si) => (s.values || []).map((v, i) => {
            const x = pad + (i * (w - pad * 2)) / n;
            const bw = Math.max(4, ((w - pad * 2) / n - 6) / series.length);
            const barH = ((v || 0) / max) * (h - pad - 12);
            if (props.kind === 'line') {
              if (i === 0) return null;
              const x0 = pad + ((i - 1) * (w - pad * 2)) / n + bw;
              const y0 = h - pad - ((s.values[i - 1] || 0) / max) * (h - pad - 12);
              const x1 = x + bw;
              const y1 = h - pad - barH;
              return <line key={`${si}-${i}`} x1={x0} y1={y0} x2={x1} y2={y1} className={`oui-line s${si}`} />;
            }
            return <rect key={`${si}-${i}`} x={x + si * bw} y={h - pad - barH} width={bw} height={barH} className={`oui-bar s${si}`} rx="2" />;
          }))}
          {labels.map((lab, i) => (
            <text key={lab} x={pad + (i * (w - pad * 2)) / n + 8} y={h - 8} className="oui-axis">{lab}</text>
          ))}
        </svg>
      )}
      {props.caption && <p className="oui-caption">{props.caption}</p>}
    </Card>
  );
}

function Pie({ labels, values }) {
  const total = values.reduce((a, b) => a + (b || 0), 0) || 1;
  let acc = 0;
  const r = 48, cx = 60, cy = 60;
  const slices = values.map((v, i) => {
    const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += v || 0;
    const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    return { d: `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`, i, label: labels[i], v };
  });
  return (
    <div className="oui-pie-wrap">
      <svg viewBox="0 0 120 120" className="oui-pie" aria-hidden="true">
        {slices.map(s => <path key={s.i} d={s.d} className={`oui-bar s${s.i % 4}`} />)}
      </svg>
      <ul className="oui-legend">{slices.map(s => <li key={s.i}><i className={`s${s.i % 4}`} />{s.label}: {s.v}</li>)}</ul>
    </div>
  );
}

export function ProgressView({ props }) {
  const mark = { pending: '○', running: '…', done: '✓', error: '✗' };
  return (
    <Card>
      <Head icon="flow" title={props.title || 'Progresso'} />
      <ol className="oui-steps">
        {(props.steps || []).map((s, i) => (
          <li key={s.id || i} className={`oui-step ${s.status}`}>
            <span className="oui-step-mark" aria-hidden="true">{mark[s.status] || '·'}</span>
            <span>
              <b>{s.title}</b>
              {s.detail && <small>{s.detail}</small>}
            </span>
            <span className="oui-step-bar" aria-hidden="true"><i data-s={s.status} /></span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function LinkPreviewView({ props }) {
  return (
    <Card className="oui-link">
      <a href={props.url} target="_blank" rel="noopener noreferrer" className="oui-link-a">
        {props.icon ? <img src={props.icon} alt="" width={28} height={28} /> : <span className="oui-ico"><Icon name="globe" size={15} /></span>}
        <span>
          <b>{props.title || props.host || props.url}</b>
          {props.description && <small>{props.description}</small>}
          <small className="oui-host">{props.host || props.url}</small>
        </span>
      </a>
    </Card>
  );
}

export function PrCardView({ props }) {
  const tone = { open: 'ok', draft: 'warn', merged: 'ok', closed: 'err' }[props.status] || 'neutral';
  return (
    <Card>
      <Head icon="branch" title={props.repo || 'Pull request'} extra={<Badge tone={tone}>{props.status}</Badge>} />
      <p className="oui-lead">{props.number ? `#${props.number} ` : ''}{props.title}</p>
      {props.author && <p className="oui-muted">por {props.author}</p>}
      <a className="link" href={props.url} target="_blank" rel="noopener noreferrer">Abrir PR</a>
    </Card>
  );
}

export function FileCardView({ props }) {
  const href = props.url || (props.fileId ? `/api/files/${props.fileId}` : null);
  return (
    <Card className="oui-file">
      <Head icon="file" title={props.name} extra={props.size != null && <Badge>{props.size} B</Badge>} />
      {props.type && <p className="oui-muted">{props.type}</p>}
      {href && <a className="link" href={href} target="_blank" rel="noopener noreferrer">Abrir</a>}
    </Card>
  );
}

export function MediaGalleryView({ props }) {
  return (
    <Card>
      <Head icon="image" title={props.title || 'Galeria'} />
      <ul className="oui-gallery">
        {(props.items || []).map((it, i) => (
          <li key={i}>
            {it.type === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(it.src) ? (
              <img src={it.src} alt={it.alt || it.name || ''} />
            ) : (
              <a href={it.src} target="_blank" rel="noopener noreferrer">{it.name || it.alt || it.src}</a>
            )}
            {it.name && <small>{it.name}</small>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function HtmlPreviewView({ props }) {
  const [tab, setTab] = useState('preview');
  const src = props.source || props.html;
  return (
    <Card padded={false}>
      <div className="oui-html-bar">
        <Head icon="cube" title={props.title || 'Prévia HTML'} />
        <Tabs items={[{ id: 'preview', label: 'Prévia' }, { id: 'source', label: 'Código' }]} value={tab} onChange={setTab} />
      </div>
      {tab === 'preview' ? (
        <iframe className="oui-frame" title={props.title || 'Prévia'} sandbox="allow-scripts" srcDoc={props.html} />
      ) : (
        <pre className="oui-src">{src}</pre>
      )}
    </Card>
  );
}

export function SlidesView({ props, state, onAction }) {
  const disabled = locked(state);
  return (
    <Card>
      <Head icon="sparkles" title={props.title || 'Escolha um visual'} />
      <ul className="oui-slides">
        {(props.samples || []).map(s => (
          <li key={s.id}>
            <button type="button" className="oui-slide" disabled={disabled} onClick={() => onAction('choose', { id: s.id })}>
              {s.preview ? <img src={s.preview} alt="" /> : <span className="oui-slide-ph">{s.title[0]}</span>}
              <b>{s.title}</b>
              {s.description && <small>{s.description}</small>}
            </button>
          </li>
        ))}
      </ul>
      <Receipt state={state} text="Visual escolhido" />
    </Card>
  );
}

export function SettingView({ props, state, onAction }) {
  const disabled = locked(state);
  return (
    <Card status={cardStatus(state)} role="group" aria-label={props.label}>
      <Head icon="gear" title="Configuração" />
      <div className="oui-setting">
        <span><b>{props.label}</b>{props.description && <small>{props.description}</small>}</span>
        <Button variant="default" disabled={disabled} onClick={() => onAction('apply')}>{props.proposed ? 'Ligar' : 'Desligar'}</Button>
      </div>
      {!disabled && <button type="button" className="link" onClick={() => onAction('dismiss')}>Agora não</button>}
      <Receipt state={state} text={state === 'denied' ? 'Mantida' : 'Aplicada'} />
    </Card>
  );
}

export const GENUI_VIEWS = {
  approval: ApprovalView,
  question: QuestionView,
  connect_app: ConnectAppView,
  secure_form: SecureFormView,
  draft_message: DraftMessageView,
  data_table: DataTableView,
  chart: ChartView,
  progress: ProgressView,
  link_preview: LinkPreviewView,
  pr_card: PrCardView,
  file_card: FileCardView,
  media_gallery: MediaGalleryView,
  html_preview: HtmlPreviewView,
  slides: SlidesView,
  setting: SettingView
};

export function GenUiView({ part, live, onAction }) {
  const Comp = GENUI_VIEWS[part?.component];
  const state = part?.state;
  if (state === 'input-streaming' && live) {
    return <Card status="pending"><Skeleton lines={3} label={`Montando ${GENUI_CATALOG[part.component]?.title || 'componente'}`} /></Card>;
  }
  if (!Comp || state === 'output-error') {
    return <Card status="err"><FallbackText text={part?.error ? `${part.error}\n\n${genuiToText(part.component, part.props)}` : genuiToText(part?.component, part?.props)} /></Card>;
  }
  return <Comp props={part.props || {}} state={state} onAction={onAction} />;
}
