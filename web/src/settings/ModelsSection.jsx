import { useEffect, useState } from 'react';
import { MetalBadge } from 'metal-fx';
import { useApp } from '../app.jsx';
import { api, useDark, useRoute } from '../lib.js';
import { Icon, Switch, Select, useConfirm } from '../ui.jsx';
import { AdvancedBlock } from '../disclosure.jsx';
import { MODEL_DESC, EFFORTS } from '../modelPicker.jsx';
import { PROVIDERS, ProviderGrid, ProviderHeader } from '../providersCatalog.jsx';
import { Card, Row } from './shared.jsx';

const EFFORT_CAPS = EFFORTS.filter(([k]) => k !== 'auto');

function ClaudeAccountsCard({ s, set, S }) {
  const { refresh, toast } = useApp();
  const [rows, setRows] = useState(null);
  const [info, setInfo] = useState({});
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState('');
  const [manage, setManage] = useState(false);
  const saved = S.settings.claude || {};
  const current = saved.defaultAccount || 'principal';
  const accounts = [{ id: 'principal', label: 'Conta pessoal' }, ...(saved.accounts || [])];

  const load = () => api('/api/claude/accounts').then(r => {
    setRows(r);
    for (const a of r) if (a.loggedIn && !info[a.id]) api(`/api/claude/accounts/${a.id}/test`, { method: 'POST' }).then(x => setInfo(i => ({ ...i, [a.id]: x }))).catch(() => {});
  }).catch(() => setRows([]));
  useEffect(() => { load(); }, [saved.accounts?.length]);

  async function saveClaude(patch) {
    const next = { ...saved, ...patch };
    const r = await api('/api/settings', { method: 'PUT', body: { claude: next } });
    set('claude', r.claude);
    await refresh();
  }
  async function login(id) {
    const r = await api(`/api/claude/accounts/${id}/login`, { method: 'POST' });
    toast(r.opened ? 'Abri um terminal: faça o login lá. Depois clique na conta de novo.' : `Rode no terminal: ${r.command}`);
  }
  async function choose(id) {
    if (id === current) return;
    const row = rows?.find(r => r.id === id);
    setBusy(id);
    try {
      if (!row?.loggedIn) return await login(id);
      await saveClaude({ defaultAccount: id });
      toast(`Agora o Ripper usa a conta "${accounts.find(a => a.id === id)?.label}".`);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }
  async function add() {
    const label = (adding || '').trim();
    if (!label) return;
    setBusy('add');
    try {
      await saveClaude({ accounts: [...(saved.accounts || []), { label }] });
      const r = await api('/api/claude/accounts');
      setRows(r); setAdding(null);
      const created = r.find(a => a.label === label);
      if (created) await login(created.id);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }
  async function remove(id) {
    try { await saveClaude({ accounts: saved.accounts.filter(a => a.id !== id), defaultAccount: current === id ? 'principal' : current }); }
    catch (e) { toast(e.message, 'error'); }
  }
  const sub = id => {
    const r = rows?.find(x => x.id === id), t = info[id];
    if (r?.limitedUntil) return `no limite até ${new Date(r.limitedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    if (busy === id) return 'abrindo…';
    if (t?.ok) return [t.plan, t.email].filter(Boolean).join(' · ');
    return r?.loggedIn ? 'conectada' : 'clique para fazer login';
  };

  return (
    <Card title="Conta do Claude" desc="Qual assinatura o Ripper usa. Clique para trocar; conta nova pede login uma vez.">
      <div className="seg-choice claude-accs" style={{ gridTemplateColumns: `repeat(${Math.min(accounts.length + 1, 4)}, 1fr)` }}>
        {accounts.map(a => (
          <button key={a.id} type="button" className={current === a.id ? 'on' : ''} aria-pressed={current === a.id} onClick={() => choose(a.id)} disabled={!!busy}>
            <b>{a.label}</b><small>{sub(a.id)}</small>
          </button>
        ))}
        {adding === null
          ? <button type="button" onClick={() => setAdding(accounts.some(a => /teams/i.test(a.label)) ? '' : 'Teams')} disabled={!!busy}><b>+ Adicionar</b><small>outra conta (ex.: Teams)</small></button>
          : <form className="claude-acc-new" onSubmit={e => { e.preventDefault(); add(); }}>
              <input className="input" autoFocus value={adding} maxLength={40} onChange={e => setAdding(e.target.value)} placeholder="Nome da conta" aria-label="Nome da conta nova" />
              <small className="muted" role="note">Assinatura pessoal (Pro/Max) costuma ser para uso de uma pessoa: atender clientes ou dividir pode contrariar os termos do provedor. Conta da empresa (Teams, Enterprise) só com autorização de quem a administra. Não use a conta de outra pessoa. A responsabilidade pelos termos de cada provedor é sua.</small>
              <div className="row"><button type="submit" className="btn btn-sm btn-primary" disabled={!adding.trim() || busy === 'add'}>Adicionar e entrar</button><button type="button" className="btn btn-sm" onClick={() => setAdding(null)}>Cancelar</button></div>
            </form>}
      </div>
      <Row title="Trocar sozinho no limite" desc="Se a conta em uso bater o limite, o Ripper continua pela outra e avisa no chat.">
        <Switch checked={saved.autoSwitch !== false} onChange={v => saveClaude({ autoSwitch: v }).catch(e => toast(e.message, 'error'))} label="Trocar sozinho no limite" />
      </Row>
      <button type="button" className="btn btn-sm claude-acc-manage" onClick={() => setManage(m => !m)} aria-expanded={manage}>{manage ? 'Fechar' : 'Gerenciar contas'}</button>
      {manage && (
        <ul className="rows flat">
          {accounts.map(a => (
            <li key={a.id} className="row-item">
              <div className="row-main"><b>{a.label}</b><small>{info[a.id]?.error || sub(a.id)}{rows?.find(r => r.id === a.id)?.agents?.length ? ` · usada por ${rows.find(r => r.id === a.id).agents.join(', ')}` : ''}</small></div>
              <div className="row">
                <button type="button" className="btn btn-sm" onClick={() => login(a.id).catch(e => toast(e.message, 'error'))}>Trocar login</button>
                {a.id !== 'principal' && <button type="button" className="btn btn-sm" onClick={() => remove(a.id)}>Remover</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const PAID_BODY = 'O Ripper funciona pela sua assinatura (Claude, ChatGPT) sem custo extra. Com o uso pago ativado, cada resposta de um modelo pago (OpenRouter, OpenAI, Gemini ou Claude por chave de API) é cobrada em dólar na conta do provedor, inclusive o que os agentes fizerem sozinhos (rotinas, WhatsApp). Os limites diários abaixo pausam o gasto quando atingidos.';

function PaidUsageCard({ s, set, S }) {
  const [confirm, confirmNode] = useConfirm();
  const b = s.billing || {};
  const on = !!S.settings.billing?.paidConsentAt;
  const pending = b.paidConsent === true && !on;
  const spent = S.paidSpend?.total || 0;
  const usd = n => `US$ ${(+n || 0).toFixed(2).replace('.', ',')}`;
  async function enable() {
    if (await confirm({ title: 'Ativar uso pago?', body: `${PAID_BODY} Você pode desativar quando quiser.`, action: 'Entendo, ativar uso pago', danger: true })) set('billing', { ...b, paidConsent: true });
  }
  return (
    <Card title="Uso pago" badge={on ? <span className="tag tag-warn">ativo · gasta créditos</span> : pending ? <span className="tag tag-warn">salve para ativar</span> : <span className="tag tag-ok">desligado · só assinatura</span>}>
      <div className={`paid-box ${on ? 'is-on' : ''}`} role="note">
        <Icon name="bolt" size={18} />
        <p><b>{on ? 'Os agentes podem gastar dinheiro.' : 'Isto gasta dinheiro.'}</b> {PAID_BODY}</p>
      </div>
      {on && <Row title="Gasto pago de hoje" desc={`Desde ${new Date(S.settings.billing.paidConsentAt).toLocaleDateString('pt-BR')} com uso pago ativo. Zera à meia-noite.`}><b className="mono">{usd(spent)} de {usd(b.totalDailyUsd ?? 10)}</b></Row>}
      <Row title="Limite por agente, por dia" desc="Ao atingir, o agente para de usar modelos pagos até amanhã e você recebe um aviso na Caixa.">
        <div className="input-unit"><span>US$</span><input className="input" type="number" min={0} step={0.5} value={b.perAgentDailyUsd ?? 2} onChange={e => set('billing', { ...b, perAgentDailyUsd: e.target.value })} aria-label="Limite diário por agente em dólares" /></div>
      </Row>
      <Row title="Limite de todos os agentes, por dia">
        <div className="input-unit"><span>US$</span><input className="input" type="number" min={0} step={1} value={b.totalDailyUsd ?? 10} onChange={e => set('billing', { ...b, totalDailyUsd: e.target.value })} aria-label="Limite diário total em dólares" /></div>
      </Row>
      <Row title="Cotação do dólar" desc="Para mostrar custos em R$. Vazio = cotação do dia (AwesomeAPI), ou R$ 5,50 se não der para buscar.">
        <div className="input-unit"><span>R$</span><input className="input" type="number" min={0} step={0.01} placeholder="auto" value={b.usdBrl ?? ''} onChange={e => set('billing', { ...b, usdBrl: e.target.value })} aria-label="Cotação do dólar em reais" /></div>
      </Row>
      <div className="row">
        {on || pending
          ? <button type="button" className="btn" onClick={() => set('billing', { ...b, paidConsent: false })}>Desativar uso pago</button>
          : <button type="button" className="btn btn-danger" onClick={enable}>Ativar uso pago…</button>}
      </div>
      {confirmNode}
    </Card>
  );
}

const COMPAT_UI = {
  openrouter: { title: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', keyHost: 'openrouter.ai/keys', ph: 'sk-or-…', search: 'gpt, gemini, deepseek, llama…',
    desc: 'Uma chave só para usar GPT, Gemini, DeepSeek, Llama e centenas de outros modelos, com as ferramentas do Ripper (computador, navegador, memória). Pago por uso na sua conta do OpenRouter.' },
  openai: { title: 'OpenAI API', keyUrl: 'https://platform.openai.com/api-keys', keyHost: 'platform.openai.com/api-keys', ph: 'sk-…', search: 'gpt-5, gpt-4.1, o4…',
    desc: 'GPT direto pela chave da OpenAI, com as ferramentas do Ripper. Pago por uso na sua conta da OpenAI (o custo aqui é estimado pelos tokens).' },
  gemini: { title: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyHost: 'aistudio.google.com/apikey', ph: 'AIza…', search: 'flash, pro…',
    desc: 'Modelos Gemini pela chave do Google AI Studio (os mesmos do Antigravity), com as ferramentas do Ripper. O AI Studio tem cota grátis; acima dela, pago por uso (custo estimado pelos tokens).' },
  ollama: { title: 'Ollama', local: true, search: 'llama, qwen, deepseek…',
    desc: 'Modelos rodando nesta máquina: grátis, offline e nada sai do computador. Instale em ollama.com, baixe um modelo (ex.: ollama pull qwen3) e adicione aqui. Prefira modelos que aceitam ferramentas (qwen3, llama3.1+, mistral).' }
};

function OpenRouterCard({ s, set, prov = 'openrouter' }) {
  const ui = COMPAT_UI[prov];
  const or = s[prov] || { apiKey: '', models: [], url: '' };
  const [check, setCheck] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [q, setQ] = useState('');
  const setOr = patch => set(prov, { ...or, ...patch });
  const connected = ui.local || !!or.apiKey;
  async function test() {
    setCheck('testing');
    try { setCheck(await api(`/api/providers/${prov}/test`, { method: 'POST', body: { apiKey: or.apiKey, url: or.url } })); }
    catch (e) { setCheck({ ok: false, error: e.message }); }
  }
  async function openCatalog() {
    try { setCatalog(await api(`/api/providers/${prov}/models`)); } catch (e) { setCheck({ ok: false, error: e.message }); }
  }
  const chosen = new Set(or.models.map(m => m.id));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = (catalog || []).filter(m => m.tools && !chosen.has(m.id) && words.every(w => `${m.id} ${m.label}`.toLowerCase().includes(w))).slice(0, 30);
  const price = n => (n < 1 ? n.toFixed(2) : n.toFixed(1)).replace('.', ',');
  const status = check === 'testing' ? <span className="tag" role="status">Testando…</span>
    : check?.ok ? <span className="tag tag-ok">conectado</span>
    : check ? <span className="tag tag-warn">{check.error}</span>
    : ui.local ? <span className="tag">local</span> : or.apiKey ? <span className="tag">chave salva</span> : <span className="tag">não conectado</span>;
  return (
    <Card title={ui.title} badge={status} desc={ui.desc}>
      {!ui.local && !s.billing?.paidConsentAt && <p className="paid-inline"><Icon name="bolt" size={14} />Os modelos do {ui.title} só respondem com o uso pago ativado (acima).</p>}
      {ui.local ? (
        <Row title="Endereço do Ollama" desc="Padrão desta máquina. Mude só se o Ollama roda em outro computador da rede.">
          <div className="row">
            <input className="input" value={or.url || 'http://127.0.0.1:11434'} onChange={e => { setOr({ url: e.target.value }); setCheck(null); }} aria-label="Endereço do Ollama" />
            <button type="button" className="btn" disabled={check === 'testing'} onClick={test}>Testar</button>
          </div>
        </Row>
      ) : (
        <Row title="Chave da API" desc={<>Crie em <a href={ui.keyUrl} target="_blank" rel="noopener">{ui.keyHost}</a>.</>}>
          <div className="row">
            <input className="input" type="password" autoComplete="off" value={or.apiKey} onChange={e => { setOr({ apiKey: e.target.value }); setCheck(null); }} placeholder={ui.ph} aria-label={`Chave do ${ui.title}`} />
            <button type="button" className="btn" disabled={!or.apiKey || check === 'testing'} onClick={test}>Testar</button>
          </div>
        </Row>
      )}
      {ui.local && <LocalModelPick onDone={m => !or.models.some(x => x.id === m.id) && setOr({ models: [...or.models, { id: m.id, label: m.label }] })} />}
      <Row title="Modelos em uso" desc="Aparecem no seletor de modelo das conversas e dos agentes depois de salvar." stack>
        {or.models.length ? (
          <ul className="rows flat">{or.models.map(m => (
            <li key={m.id} className="row-item">
              <div className="row-main"><b>{m.label}</b><small className="mono">{m.id}</small></div>
              <button type="button" className="btn btn-sm" onClick={() => setOr({ models: or.models.filter(x => x.id !== m.id) })}>Remover</button>
            </li>
          ))}</ul>
        ) : <p className="muted small">Nenhum ainda.</p>}
        {catalog ? (
          <div className="or-catalog">
            <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder={`Buscar: ${ui.search}`} aria-label={`Buscar modelo no ${ui.title}`} autoFocus />
            <ul className="rows flat">{found.map(m => (
              <li key={m.id} className="row-item">
                <div className="row-main"><b>{m.label}</b><small className="mono">{m.id}{m.priceIn > 0 ? ` · US$ ${price(m.priceIn)} / ${price(m.priceOut)} por milhão de tokens` : ui.local ? ' · grátis' : ''}</small></div>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setOr({ models: [...or.models, { id: m.id, label: m.label }] })}>Adicionar</button>
              </li>
            ))}</ul>
            {!found.length && <p className="muted small">{ui.local && !(catalog || []).length ? 'Nenhum modelo baixado. Rode, por exemplo: ollama pull qwen3' : 'Nada encontrado.'}</p>}
          </div>
        ) : <button type="button" className="btn" disabled={!connected} onClick={openCatalog}><Icon name="plus" size={16} />Adicionar modelos</button>}
      </Row>
    </Card>
  );
}

function LocalModelPick({ onDone }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/api/local-models').then(setInfo, e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const pull = info?.pull;
  useEffect(() => {
    if (!pull?.running) { if (pull?.status === 'pronto') onDone(info.models.find(m => m.id === pull.model)); return; }
    const t = setTimeout(load, 1000); return () => clearTimeout(t);
  }, [pull?.running, pull?.pct, pull?.status]);
  if (!info) return err ? <p className="muted small">{err}</p> : null;
  const { hardware: hw, pick } = info;
  const desc = `${hw.ramGb} GB de RAM${hw.gpu ? ` · ${hw.gpu} (${hw.vramGb} GB)` : hw.appleSilicon ? ' · Apple Silicon' : ''}`;
  async function start() {
    setErr('');
    try { await api('/api/local-models/pull', { method: 'POST', body: { model: pick.id } }); load(); } catch (e) { setErr(e.message); }
  }
  return (
    <Row title="Modelo recomendado para este computador" desc={desc}>
      {!pick ? <p className="muted small">Este computador não tem memória para um modelo local útil.</p>
        : !info.ollama ? <p className="muted small">Instale o Ollama em <a href="https://ollama.com" target="_blank" rel="noopener">ollama.com</a> e abra-o; depois volte aqui.</p>
        : pull?.running ? <span className="tag" role="status">Baixando {pull.model}… {pull.pct ?? 0}%</span>
        : <div className="row"><b>{pick.label}</b><button type="button" className="btn btn-primary" onClick={start}>Baixar e usar</button></div>}
      {(err || pull?.error) && <p className="muted small">{err || pull.error}</p>}
    </Row>
  );
}

export default function ModelsSection({ s, set }) {
  const { S } = useApp();
  const dark = useDark();
  const [julia, setJulia] = useState(null);
  const [claudeLogged, setClaudeLogged] = useState(null);
  const [prov, setProv] = useState(null);
  const provQuery = useRoute().query.get('prov');
  useEffect(() => { if (provQuery) setProv(provQuery); }, [provQuery]);
  const P = PROVIDERS.find(p => p.id === prov);
  const provCounts = Object.values(S.models).reduce((o, m) => (m.provider && (o[m.provider] = (o[m.provider] || 0) + 1), o), {});
  const provStatus = {
    julia: julia === null ? { tone: 'off', label: 'verificando…' } : julia ? { tone: 'ok', label: 'no ar' } : { tone: 'warn', label: 'fora do ar' },
    claude: s.claude.mode === 'api' ? (s.claude.apiKey ? { tone: 'ok', label: 'API key' } : { tone: 'warn', label: 'falta a chave' })
      : claudeLogged === null ? { tone: 'off', label: 'verificando…' } : claudeLogged ? { tone: 'ok', label: 'assinatura' } : { tone: 'warn', label: 'falta entrar' },
    codex: S.meta?.codexInstalled ? { tone: 'ok', label: 'conectado' } : { tone: 'warn', label: 'não instalado' },
    openrouter: s.openrouter?.apiKey ? { tone: 'ok', label: 'chave salva' } : { tone: 'off', label: 'não conectado' },
    openai: s.openai?.apiKey ? { tone: 'ok', label: 'chave salva' } : { tone: 'off', label: 'não conectado' },
    gemini: s.gemini?.apiKey ? { tone: 'ok', label: 'chave salva' } : { tone: 'off', label: 'não conectado' },
    ollama: s.ollama?.models?.length ? { tone: 'ok', label: `${s.ollama.models.length} modelo(s)` } : { tone: 'off', label: 'sem modelos' }
  };
  useEffect(() => {
    api('/api/julia/status').then(r => setJulia(r.online)).catch(() => setJulia(false));
    api('/api/claude/accounts').then(r => setClaudeLogged(r.find(a => a.id === (S.settings.claude?.defaultAccount || 'principal'))?.loggedIn ?? false)).catch(() => setClaudeLogged(false));
  }, []);

  if (!P) {
    return (
      <>
        <ProviderGrid status={provStatus} counts={provCounts} dark={dark} onOpen={setProv} />
        <Card title="Padrão para agentes novos">
          <Row title="Modelo" desc="Cada agente e cada conversa podem trocar depois.">
            <Select label="Modelo padrão" value={s.defaultModel} onChange={v => set('defaultModel', v)} options={Object.entries(S.models).filter(([k]) => k === 'auto' || s.models?.enabled?.[k] !== false).map(([k, m]) => ({ value: k, label: m.label, hint: MODEL_DESC[k] }))} />
          </Row>
        </Card>
        <Card title="Fila de entrada" desc="Mensagens seguidas no composer são agrupadas num único turno. Enter reinicia a janela; o botão Enviar manda na hora.">
          <Row title="Agrupar mensagens consecutivas"><Switch checked={s.inputQueue?.enabled !== false} onChange={v => set('inputQueue', { ...(s.inputQueue || {}), enabled: v })} label="Coalescing ativo" /></Row>
          <Row title="Janela de agrupamento" desc="Tempo de espera após Enter antes de mandar ao agente (0 desliga o atraso quando o coalescing está ativo).">
            <div className="input-unit"><input className="input" type="number" min={0} max={10} step={0.5} value={(s.inputQueue?.windowMs ?? 2500) / 1000} onChange={e => set('inputQueue', { ...(s.inputQueue || {}), windowMs: Math.round(+e.target.value * 1000) })} /><span>segundos</span></div>
          </Row>
        </Card>
      </>
    );
  }

  return (
    <>
      <ProviderHeader p={P} status={provStatus} dark={dark} onBack={() => setProv(null)} />
      {P.id === 'claude' && <>
      <Card title="Conexão" badge={<span className="tag">Opus 5.5 · Sonnet 5.5 · Fable 5.1</span>}>
        <Row title="Como conectar">
          <div className="seg-choice">
            {[['subscription', 'Assinatura', 'claude login desta máquina'], ['api', 'API key', 'pago por uso: gasta créditos']].map(([k, l, h]) => (
              <button key={k} type="button" className={s.claude.mode === k ? 'on' : ''} onClick={() => set('claude.mode', k)}><b>{l}</b><small>{h}</small></button>
            ))}
          </div>
        </Row>
        {s.claude.mode === 'api' && <p className="paid-inline"><Icon name="bolt" size={14} />Com chave de API, cada resposta do Claude é cobrada na sua conta da Anthropic. Precisa do uso pago ativado (abaixo).</p>}
        {s.claude.mode === 'api' && <Row title="Anthropic API key"><input className="input" type="password" autoComplete="off" value={s.claude.apiKey} onChange={e => set('claude.apiKey', e.target.value)} placeholder="sk-ant-…" /></Row>}
        <Row title="Conectores do claude.ai" desc="Gmail, Drive e outros. Carregar custa tokens: só vale para agentes com Plugins MCP."><Switch checked={s.claude.useConnectors} onChange={v => set('claude.useConnectors', v)} label="Conectores do claude.ai" /></Row>
      </Card>
      </>}
      {P.id === 'claude' && s.claude.mode !== 'api' && <ClaudeAccountsCard s={s} set={set} S={S} />}
      {P.id === 'claude' && s.claude.mode === 'api' && <PaidUsageCard s={s} set={set} S={S} />}
      {P.id === 'codex' && <>
      <Card title="Conexão" badge={<span className="tag">Codex</span>}>
        <Row title="Login" desc="Rode codex login uma vez nesta máquina. Sem o Codex instalado, o Ripper Auto usa só o Claude."><code className="inline-code">npm i -g @openai/codex</code></Row>
        <Row title="Apps conectados do ChatGPT" desc="Quando houver suporte."><Switch checked={s.chatgpt.useConnectedApps} onChange={v => set('chatgpt.useConnectedApps', v)} label="Apps do ChatGPT" /></Row>
      </Card>
      </>}
      {['openrouter', 'openai', 'gemini'].includes(P.id) && <><PaidUsageCard s={s} set={set} S={S} /><OpenRouterCard s={s} set={set} prov={P.id} /></>}
      {P.id === 'ollama' && <OpenRouterCard s={s} set={set} prov="ollama" />}
      {P.id === 'julia' && <>
      <Card title="Como a Julia trabalha" badge={<><MetalBadge theme={dark ? 'dark' : 'light'}>Julia 1</MetalBadge>{julia === null ? <span className="tag" role="status">Verificando…</span> : <span className={`tag ${julia ? 'tag-ok' : 'tag-warn'}`}>{julia ? 'no ar' : 'fora do ar'}</span>}</>} desc="A Julia 1 escolhe modelo e prioridades antes do modelo grande. Fora do ar, as regras de reserva decidem.">
        <AdvancedBlock settings={s} hint="Limites de API, Julia e detalhes do Codex" className="in-card">
          <p className="set-card-desc">Quando a API devolve rate limit (429), o Ripper espera antes de tentar de novo ou mudar de modelo.</p>
          <Row title="Tentativas por modelo" desc="Inclui a primeira chamada. Depois disso, pode haver fallback para outro provedor.">
            <div className="input-unit"><input className="input" type="number" min={1} max={6} value={s.providerRetry?.maxAttempts ?? 3} onChange={e => set('providerRetry', { ...(s.providerRetry || {}), maxAttempts: +e.target.value })} /><span>tentativas</span></div>
          </Row>
          <Row title="Espera máxima entre tentativas"><div className="input-unit"><input className="input" type="number" min={1} max={120} value={Math.round((s.providerRetry?.maxDelayMs ?? 60000) / 1000)} onChange={e => set('providerRetry', { ...(s.providerRetry || {}), maxDelayMs: +e.target.value * 1000 })} /><span>segundos</span></div></Row>
          <Row title="Endereço do Julia 1" desc="Serviço local de triagem (npm run julia)."><input className="input" value={s.julia.url} onChange={e => set('julia.url', e.target.value)} /></Row>
          <Row title="Ferramentas Ripper no Codex" desc="Com o Codex, remember, artefatos, inbox e o MCP ripper vão por stdio. WebSearch do Claude e conectores claude.ai não existem no Codex." />
        </AdvancedBlock>
      </Card>
      </>}
      {P.provider && (provCounts[P.provider] || 0) > 0 && <>
      <Card title="Modelos" desc="Desligue os que você não quer usar e limite o esforço de cada um. O Ripper Auto e a Julia 1 só escolhem dentro disso.">
        {Object.entries(S.models).filter(([k, m]) => k !== 'auto' && m.provider === P.provider).map(([k, m]) => {
          const on = s.models?.enabled?.[k] !== false;
          const connected = m.provider === 'codex' ? S.meta?.codexInstalled : true;
          const others = Object.keys(S.models).filter(x => x !== 'auto' && x !== k && s.models?.enabled?.[x] !== false);
          const setModels = patch => set('models', { enabled: { ...(s.models?.enabled || {}) }, maxEffort: { ...(s.models?.maxEffort || {}) }, ...patch(s.models || {}) });
          return (
            <Row key={k} title={<>{m.label}{!connected && <span className="tag warn model-conn">não instalado</span>}</>} desc={MODEL_DESC[k]}>
              <div className="model-policy-ctrl">
                <Select label={`Esforço máximo de ${m.label}`} value={s.models?.maxEffort?.[k] || ''} disabled={!on}
                  onChange={v => setModels(cur => ({ maxEffort: { ...(cur.maxEffort || {}), [k]: v || undefined } }))}
                  options={[{ value: '', label: 'Sem limite' }, ...EFFORT_CAPS.map(([v, l]) => ({ value: v, label: `Até ${l.toLowerCase()}` }))]} />
                <Switch checked={on} disabled={on && !others.length} label={`Usar ${m.label}`}
                  onChange={v => setModels(cur => ({ enabled: { ...(cur.enabled || {}), [k]: v } }))} />
              </div>
            </Row>
          );
        })}
      </Card>
      </>}
    </>
  );
}
