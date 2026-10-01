import { useRef, useState } from 'react';
import { BotAvatar } from 'bot-avatars';
import { useApp } from '../app.jsx';
import { api, go, useRoute, fmtSize, TOOL_INFO, TONES, useDark } from '../lib.js';
import { AgentAvatar, Icon, Select } from '../ui.jsx';
import { EffortScale, MODEL_DESC } from '../modelPicker.jsx';
import { uploadFile } from '../composer.jsx';

const TYPES = ['clover', 'flower', 'triangle', 'square', 'blob', 'ghost', 'circle', 'drop', 'star', 'droid', 'mech', 'alien', 'hexagon', 'cat', 'cloud', 'pill', 'pebble', 'puddle'];
const COLORS = [null, '#1a1917', '#e8537a', '#f08a3c', '#f2c94c', '#3fae78', '#3aa7c9', '#5b6cf0', '#9b6cf0'];
const BLANK = { name: '', description: '', category: 'Outro', instructions: '', tone: 'direto', tools: ['web', 'memory', 'files'], templateId: null, savedTemplateId: null };

function Section({ n, title, hint, children, optional }) {
  return (
    <section className="na-section">
      <header><span className="na-n">{n}</span><div><h2>{title}{optional && <span className="na-opt">opcional</span>}</h2>{hint && <p>{hint}</p>}</div></header>
      <div className="na-body">{children}</div>
    </section>
  );
}

export default function NewAgent() {
  const { S, refresh, toast } = useApp();
  const { query } = useRoute();
  const dark = useDark();
  const first = S.templates.find(t => t.id === query.get('template'));
  const [v, setV] = useState(() => ({
    ...BLANK, model: S.settings.defaultModel, effort: 'auto',
    avatar: { type: first?.avatar.type || TYPES[Math.floor(Math.random() * 9)], color: null, face: 'eyes' },
    ...(first ? { name: first.name, description: first.description, category: first.category, instructions: first.instructions, tools: first.tools, templateId: first.id } : {})
  }));
  const [files, setFiles] = useState([]);
  const [look, setLook] = useState(false);
  const [more, setMore] = useState(!!first?.instructions);
  const [saving, setSaving] = useState(false);
  const input = useRef(null), nameRef = useRef(null);
  const set = p => setV(x => ({ ...x, ...p }));

  function applyTemplate(t) {
    if (!t) { setV(x => ({ ...x, ...BLANK, avatar: x.avatar })); nameRef.current?.focus(); return; }
    setV(x => ({ ...x, name: t.name, description: t.description, category: t.category, instructions: t.instructions, tools: t.tools, templateId: t.id, avatar: { ...x.avatar, type: t.avatar.type } }));
    setMore(true);
  }
  const toggleTool = t => set({ tools: v.tools.includes(t) ? v.tools.filter(x => x !== t) : [...v.tools, t] });

  async function create(e) {
    e?.preventDefault();
    if (!v.name.trim()) { nameRef.current?.focus(); return toast('Dê um nome ao agente.', 'error'); }
    setSaving(true);
    try {
      const body = { ...v, name: v.name.trim() };
      if (v.savedTemplateId) { body.savedTemplateId = v.savedTemplateId; delete body.templateId; }
      const a = await api('/api/agents', { method: 'POST', body });
      for (const f of files) { try { await uploadFile(a.id, null, f); } catch (err) { toast(err.message, 'error'); } }
      await refresh();
      toast(`${a.name} está pronto`);
      go(`/a/${a.id}`);
    } catch (err) { toast(err.message, 'error'); setSaving(false); }
  }

  const computerNote = S.settings.computer.mode === 'off' ? 'Computador desligado em Integrações.' : S.settings.computer.mode === 'boat' && !S.settings.computer.boatApiKey ? 'Falta a chave do boat.dev em Integrações.' : null;

  return (
    <form className="na" onSubmit={create}>
      <header className="na-top">
        <button type="button" className="link" onClick={() => (history.length > 1 ? history.back() : go('/agents'))}><Icon name="arrowL" size={16} />Voltar</button>
        <h1>Novo agente</h1>
        <div className="grow" />
        <button type="button" className="btn" onClick={() => go('/agents')}>Cancelar</button>
        <button className="btn btn-primary" disabled={saving || !v.name.trim()}>{saving ? 'Criando…' : 'Criar agente'}</button>
      </header>

      <div className="na-grid">
        <div className="na-form">
          <Section n="1" title="Comece por um modelo" hint="Um ponto de partida preenche tudo. Dá para mudar qualquer coisa depois.">
            <div className="na-templates">
              <button type="button" className={`na-tpl ${!v.templateId ? 'on' : ''}`} onClick={() => applyTemplate(null)}>
                <span className="na-tpl-ico"><Icon name="plus" size={18} /></span><span className="na-tpl-text"><b>Do zero</b><small>Em branco</small></span>
              </button>
              {S.templates.map(t => (
                <button type="button" key={t.id} className={`na-tpl ${v.templateId === t.id && !v.savedTemplateId ? 'on' : ''}`} onClick={() => { set({ savedTemplateId: null }); applyTemplate(t); }} title={t.description}>
                  <BotAvatar type={t.avatar.type} size={30} paused interactive={false} theme={dark ? 'dark' : 'light'} /><span className="na-tpl-text"><b>{t.name}</b><small>{t.category}</small></span>
                </button>
              ))}
              {(S.savedAgentTemplates || []).map(t => (
                <button type="button" key={t.id} className={`na-tpl ${v.savedTemplateId === t.id ? 'on' : ''}`} onClick={() => {
                  setV(x => ({
                    ...x,
                    savedTemplateId: t.id,
                    templateId: t.builtinTemplateId || null,
                    name: t.name,
                    description: t.description,
                    category: t.category,
                    instructions: t.instructions,
                    tone: t.tone,
                    tools: t.tools,
                    model: t.model,
                    effort: t.effort,
                    avatar: { ...x.avatar, ...(t.avatar || {}) }
                  }));
                  setMore(true);
                }} title={t.description || 'Modelo salvo'}>
                  <AgentAvatar agent={{ ...t, status: 'online' }} size={30} paused />
                  <span className="na-tpl-text"><b>{t.name}</b><small>Salvo · {t.category}</small></span>
                </button>
              ))}
            </div>
          </Section>

          <Section n="2" title="Quem é" hint="Nome e o que ele faz, numa frase.">
            <div className="na-identity">
              <button type="button" className="na-avatar" onClick={() => setLook(l => !l)} aria-expanded={look} aria-label="Escolher avatar">
                <AgentAvatar agent={{ ...v, status: 'online' }} size={60} />
                <span className="na-avatar-edit"><Icon name="edit" size={13} /></span>
              </button>
              <div className="na-fields">
                <input ref={nameRef} className="na-name" value={v.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder="Nome do agente" aria-label="Nome do agente" autoFocus={!first} />
                <input className="input" value={v.description} maxLength={200} onChange={e => set({ description: e.target.value })} placeholder="Ex.: Analisa planilhas e explica os números em linguagem simples." aria-label="O que ele faz" />
              </div>
            </div>
            {look && (
              <div className="na-look">
                <div className="na-shapes" role="radiogroup" aria-label="Forma">
                  {TYPES.map(t => (
                    <button type="button" key={t} role="radio" aria-checked={v.avatar.type === t} aria-label={t} className={`avatar-opt ${v.avatar.type === t ? 'on' : ''}`} onClick={() => set({ avatar: { ...v.avatar, type: t } })}>
                      <BotAvatar type={t} color={v.avatar.color || undefined} size={34} paused interactive={false} theme={dark ? 'dark' : 'light'} />
                    </button>
                  ))}
                </div>
                <div className="swatches" role="radiogroup" aria-label="Cor">
                  {COLORS.map(c => <button type="button" key={c || 'auto'} role="radio" aria-checked={v.avatar.color === c} aria-label={c || 'Cor original'} className={`swatch ${v.avatar.color === c ? 'on' : ''} ${c ? '' : 'swatch-auto'}`} style={c ? { background: c } : undefined} onClick={() => set({ avatar: { ...v.avatar, color: c } })} />)}
                </div>
              </div>
            )}
            <div className="na-inline">
              <span className="na-label">Categoria</span>
              <Select label="Categoria" value={v.category} onChange={category => set({ category })} options={S.categories.map(c => ({ value: c, label: c }))} size="sm" />
            </div>
          </Section>

          <Section n="3" title="O que ele pode fazer" hint="Ligue só o que ele precisa.">
            <div className="na-tools">
              {Object.entries(TOOL_INFO).map(([k, t]) => {
                const on = v.tools.includes(k);
                return (
                  <button type="button" key={k} role="switch" aria-checked={on} className={`na-tool ${on ? 'on' : ''}`} onClick={() => toggleTool(k)}>
                    <span className="na-tool-ico"><Icon name={t.icon} /></span>
                    <span className="na-tool-text"><b>{t.label}</b><small>{k === 'computer' && computerNote && on ? computerNote : t.desc}</small></span>
                    <span className="na-check">{on && <Icon name="check" size={13} />}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section n="4" title="Como ele responde">
            <div className="na-inline">
              <span className="na-label">Tom</span>
              <div className="pills">{TONES.map(([k, l]) => <button type="button" key={k} className={`pill ${v.tone === k ? 'on' : ''}`} onClick={() => set({ tone: k })}>{l}</button>)}</div>
            </div>
            <div className="na-inline">
              <span className="na-label">Modelo</span>
              <Select label="Modelo" value={v.model} onChange={model => set({ model })} options={Object.entries(S.models).map(([k, m]) => ({ value: k, label: m.label, hint: MODEL_DESC[k] }))} />
            </div>
            <div className="na-inline top">
              <span className="na-label">Esforço</span>
              <EffortScale value={v.effort} model={v.model} onChange={effort => set({ effort })} />
            </div>
          </Section>

          <Section n="5" title="Instruções e conhecimento" optional hint="Regras próprias e arquivos que ele deve conhecer.">
            {!more ? <button type="button" className="btn btn-ghost-line" onClick={() => setMore(true)}><Icon name="plus" size={15} />Adicionar instruções ou arquivos</button> : <>
              <label className="field">Instruções<textarea rows={5} value={v.instructions} maxLength={8000} onChange={e => set({ instructions: e.target.value })} placeholder="Ex.: Sempre cite a fonte. Nunca prometa prazos. Responda em tópicos." /></label>
              <button type="button" className="dropzone compact" onClick={() => input.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setFiles(f => [...f, ...e.dataTransfer.files]); }}>
                <Icon name="paperclip" size={18} /><span><b>Arquivos de conhecimento</b><small>Arraste ou clique. Até 25 MB cada.</small></span>
              </button>
              <input ref={input} type="file" multiple hidden onChange={e => { setFiles(f => [...f, ...e.target.files]); e.target.value = ''; }} />
              {files.length > 0 && <ul className="na-files">{files.map((f, i) => (
                <li key={i}><Icon name="file" size={14} /><span>{f.name}</span><small>{fmtSize(f.size)}</small>
                  <button type="button" className="icon-btn sm" aria-label={`Remover ${f.name}`} onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button></li>
              ))}</ul>}
            </>}
          </Section>
        </div>

        <aside className="na-preview" aria-label="Prévia do agente">
          <p className="na-label">Prévia</p>
          <div className="na-card">
            <div className="na-card-stage"><AgentAvatar agent={{ ...v, status: 'online' }} size={112} interactive animate /></div>
            <h3>{v.name || 'Sem nome'}</h3>
            <p>{v.description || 'Descreva o que ele faz.'}</p>
            <div className="na-card-tools">
              {v.tools.length ? v.tools.map(t => <span key={t} className="tag"><Icon name={TOOL_INFO[t].icon} size={12} />{TOOL_INFO[t].label}</span>) : <span className="muted small">Sem ferramentas</span>}
            </div>
            <dl>
              <dt>Tom</dt><dd>{TONES.find(t => t[0] === v.tone)?.[1]}</dd>
              <dt>Modelo</dt><dd>{S.models[v.model]?.label}</dd>
              <dt>Categoria</dt><dd>{v.category}</dd>
              {files.length > 0 && <><dt>Arquivos</dt><dd>{files.length}</dd></>}
            </dl>
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={saving || !v.name.trim()}>{saving ? 'Criando…' : 'Criar agente'}<Icon name="arrowR" size={16} /></button>
          {!v.name.trim() && <p className="muted small center">Falta só o nome.</p>}
        </aside>
      </div>
    </form>
  );
}
