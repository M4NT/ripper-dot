import { useEffect, useState } from 'react';
import { api } from './lib.js';
import { Icon, Switch, Select } from './ui.jsx';
import { useOv } from './overlay.jsx';
import { useApp } from './app.jsx';

const STATE = {
  open: ['Conectado', 'ok'], connecting: ['Aguardando leitura do QR', 'warn'], close: ['Desconectado', ''],
  none: ['Sem sessão', ''], off: ['Evolution parada', ''], unknown: ['Sem status', '']
};

/**
 * WhatsApp sem API oficial (QR via Evolution, gerenciada pelo Ripper no Docker).
 * As opções (agente, lista, pausa) salvam com o resto da página; conectar/desconectar agem na hora.
 */
export function WhatsappWebPanel({ w, setW, Row }) {
  const { S, toast } = useApp();
  const ov = useOv();
  const [st, setSt] = useState(null);
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => api('/api/whatsapp-web/status').then(setSt).catch(() => setSt({ state: 'unknown' }));
  useEffect(() => { load(); }, []);
  // Enquanto o QR está na tela, confere a cada 3 s se o celular já leu.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(async () => {
      const r = await api('/api/whatsapp-web/status').catch(() => null);
      if (r) setSt(r);
      if (r?.state === 'open') { setQr(null); toast('WhatsApp conectado'); }
    }, 3000);
    return () => clearInterval(t);
  }, [qr]);

  const connect = async () => {
    setBusy('connect');
    try {
      const r = await api('/api/whatsapp-web/connect', { method: 'POST' });
      setQr(r.qr || null);
      setSt(s => ({ ...s, state: r.state }));
      if (r.state === 'open') toast('Já está conectado');
    } catch (e) { toast(e.message, 'error'); }
    setBusy('');
  };
  const disconnect = async wipe => {
    const ok = await ov.confirm(wipe
      ? { title: 'Apagar a sessão do WhatsApp?', body: 'Sai do WhatsApp neste número e apaga a sessão e o banco da Evolution. Para voltar, será preciso ler o QR de novo.', action: 'Apagar sessão', danger: true }
      : { title: 'Desconectar o WhatsApp?', body: 'Sai do WhatsApp neste número. O agente para de responder.', action: 'Desconectar', danger: true });
    if (!ok) return;
    setBusy('disconnect');
    try { await api('/api/whatsapp-web/disconnect', { method: 'POST', body: { wipe } }); setQr(null); setW('enabled', false); await load(); toast(wipe ? 'Sessão apagada' : 'Desconectado'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy('');
  };

  const [label, tone] = STATE[st?.state] || STATE.unknown;
  const connected = st?.state === 'open';
  return <>
    <div className="wa-risk">
      <Icon name="key" size={16} />
      <p><b>Conexão não oficial.</b> A sessão lida pelo QR dá controle total do número, e a Meta pode banir números que usam cliente não oficial. Por isso o agente só responde sozinho quem você liberar, rascunha para aprovação o resto, tem limite por hora e roda sem computador, navegador e plugins. Use um número dedicado ao atendimento.</p>
    </div>
    <Row title="Conexão" desc={st?.docker === false ? 'O Docker precisa estar rodando.' : 'A Evolution roda no Docker, presa a esta máquina (127.0.0.1); a chave dela nunca sai do servidor.'}>
      <div className="row wa-conn">
        <span className={`tag ${tone}`}>{label}</span>
        {!connected && <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || st?.docker === false} onClick={connect} aria-busy={busy === 'connect'}>{busy === 'connect' ? 'Preparando…' : 'Conectar com QR'}</button>}
        {connected && <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => disconnect(false)}>Desconectar</button>}
        <button type="button" className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => disconnect(true)}>Apagar sessão</button>
      </div>
    </Row>
    {qr && (
      <div className="wa-qr">
        <img src={qr} alt="QR code para conectar o WhatsApp" width={232} height={232} />
        <ol><li>No celular, abra o WhatsApp → <b>Aparelhos conectados</b>.</li><li>Toque em <b>Conectar um aparelho</b> e aponte para o código.</li><li>Esta tela atualiza sozinha quando conectar.</li></ol>
      </div>
    )}
    <Row title="Responder mensagens" desc="Desligado, ninguém recebe resposta.">
      <Switch checked={!!w.enabled} onChange={v => setW('enabled', v)} label="Responder no WhatsApp por QR" />
    </Row>
    <Row title="Pausar" desc="Interruptor rápido: as mensagens continuam chegando à conversa, mas o agente não responde.">
      <Switch checked={!!w.paused} onChange={v => setW('paused', v)} label="Pausar respostas" />
    </Row>
    <Row title="Agente que responde" desc="Neste canal ele roda sem computador, navegador, plugins e rotinas.">
      <Select label="Agente do WhatsApp por QR" value={w.agentId || ''} onChange={v => setW('agentId', v)} options={S.agents.map(a => ({ value: a.id, label: a.name }))} />
    </Row>
    <Row title="Ler conversas" desc="Opt-in. Guarda no Ripper (não na Evolution) as conversas individuais, nunca grupos, por 30 dias. O agente passa a ler histórico e contatos, aprende o seu jeito de escrever com as SUAS mensagens e escreve rascunhos para contatos novos. Cada leitura vai para a auditoria.">
      <Switch checked={!!w.readAll} onChange={async v => {
        if (v && !(await ov.confirm({ title: 'Ler todas as conversas?', body: 'As conversas individuais deste número passam a ser guardadas nesta máquina por 30 dias e podem ser lidas pelo agente (o texto vai para o modelo de IA). São dados dos seus contatos: use para atendimento do seu negócio e apague quando não precisar mais.', action: 'Ligar leitura' }))) return;
        setW('readAll', v);
      }} label="Ler todas as conversas" />
    </Row>
    {w.readAll && (
      <Row title="Ler grupos" desc="O agente lê os grupos para resumir e responder perguntas suas (ex.: “resuma o grupo da família de hoje”). Ele nunca responde nem age em grupo. Vale a partir de agora: mensagens antigas não ficam disponíveis.">
        <Switch checked={!!w.readGroups} onChange={v => setW('readGroups', v)} label="Ler grupos do WhatsApp" />
      </Row>
    )}
    {w.readAll && st?.history && (
      <div className="wa-history">
        <span><b>{st.history.contacts}</b> contatos · <b>{st.history.messages}</b> mensagens guardadas{st.styleFrom ? <> · estilo aprendido com <b>{st.styleFrom}</b> mensagens suas</> : ' · o estilo aparece depois de 5 mensagens suas'}</span>
        <button type="button" className="btn btn-sm btn-danger" onClick={async () => {
          if (!(await ov.confirm({ title: 'Apagar o histórico do WhatsApp?', body: 'Apaga mensagens e contatos guardados e as conversas do WhatsApp no Ripper. A conexão continua.', action: 'Apagar histórico', danger: true }))) return;
          await api('/api/whatsapp-web/history', { method: 'DELETE' }); await load(); toast('Histórico apagado');
        }}>Apagar histórico</button>
      </div>
    )}
    {w.readAll && <ContactModes w={w} setW={setW} Row={Row} />}
    <Row title="Responde sozinho" desc="Um número por linha, com DDI e DDD (ex.: +55 11 98888-7777). Sem a leitura ligada, quem não está aqui é ignorado e a mensagem não é guardada." stack>
      <div className="wa-allow-wrap">
        <textarea className="input wa-allow" rows={4} value={(w.allowlist || []).join('\n')} placeholder={'+55 11 98888-7777\n+55 21 97777-6666'}
          onChange={e => setW('allowlist', e.target.value.split('\n'))} />
        <small className="muted">{(w.allowlist || []).filter(n => n.replace(/\D/g, '').length >= 10).length} número(s) válido(s)</small>
      </div>
    </Row>
    <Consents w={w} setW={setW} Row={Row} />
  </>;
}

const HOW = [
  { value: 'mensagem', label: 'Por mensagem' }, { value: 'formulario', label: 'Formulário' },
  { value: 'contrato', label: 'Contrato' }, { value: 'verbal', label: 'Verbal' }, { value: 'outro', label: 'Outro' }
];

/** Registro de consentimento: quem aceitou ser atendido por IA, quando e como. Exigir é opcional. */
function Consents({ w, setW, Row }) {
  const [num, setNum] = useState('');
  const [how, setHow] = useState('mensagem');
  const list = Object.entries(w.consents || {});
  const add = () => {
    const d = num.replace(/\D/g, '');
    if (d.length < 10) return;
    setW('consents', { ...(w.consents || {}), [d]: { at: Date.now(), how } }); setNum('');
  };
  const del = n => { const { [n]: _, ...rest } = w.consents || {}; setW('consents', rest); };
  return <>
    <Row title="Exigir consentimento" desc="Ligado: quem não tem consentimento registrado não recebe resposta automática; o agente faz um rascunho para você aprovar.">
      <Switch checked={!!w.requireConsent} onChange={v => setW('requireConsent', v)} label="Exigir consentimento" />
    </Row>
    <Row title="Consentimentos registrados" desc="Clientes que aceitaram ser atendidos por um assistente automatizado (avise que é IA)." stack>
      <form className="row" onSubmit={e => { e.preventDefault(); add(); }}>
        <input className="input" value={num} onChange={e => setNum(e.target.value)} placeholder="+55 11 98888-7777" aria-label="Número do cliente" />
        <Select label="Como foi obtido" size="sm" value={how} onChange={setHow} options={HOW} />
        <button type="submit" className="btn btn-sm" disabled={num.replace(/\D/g, '').length < 10}>Registrar</button>
      </form>
      {list.length > 0 && <ul className="rows flat">
        {list.map(([n, c]) => (
          <li key={n} className="row-item">
            <div className="row-main"><b>+{n}</b><small>{new Date(c.at).toLocaleDateString('pt-BR')} · {HOW.find(h => h.value === c.how)?.label || c.how}</small></div>
            <button type="button" className="btn btn-sm" onClick={() => del(n)}>Remover</button>
          </li>
        ))}
      </ul>}
    </Row>
  </>;
}

const MODES = [
  { value: 'auto', label: 'Responde sozinho' },
  { value: 'draft', label: 'Rascunho para aprovar' },
  { value: 'read', label: 'Só lê' }
];

/** Autonomia por contato. Contato novo começa em rascunho; a escolha aqui vence a lista "Responde sozinho". */
function ContactModes({ w, setW, Row }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => api(`/api/whatsapp-web/contacts?q=${encodeURIComponent(q)}`).then(r => setRows(r.contacts)).catch(() => setRows([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  const setMode = (phone, mode) => setW('contactModes', { ...(w.contactModes || {}), [phone]: mode });
  return (
    <Row title="Contatos" desc="Como o agente age com cada um. Novos começam em rascunho: ele escreve, você aprova na bandeja de aprovações." stack>
      <label className="search-field"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nome ou número" aria-label="Buscar contato" /></label>
      {rows === null ? <p className="muted small">Carregando…</p> : rows.length === 0 ? <p className="muted small">Nenhum contato ainda: aparecem conforme as mensagens chegam.</p> :
        <ul className="wa-contacts">{rows.map(c => (
          <li key={c.phone}>
            <span className="grow"><b>{c.name || 'Sem nome'}</b><small className="muted">{c.mode === 'group' ? 'Grupo' : '+' + c.phone}</small></span>
            {c.mode === 'group'
              ? <span className="tag">Grupo · só leitura</span>
              : <Select label={`Modo de ${c.name || c.phone}`} size="sm" value={(w.contactModes || {})[c.phone] || c.mode || 'draft'} onChange={v => setMode(c.phone, v)} options={MODES} />}
          </li>
        ))}</ul>}
    </Row>
  );
}
