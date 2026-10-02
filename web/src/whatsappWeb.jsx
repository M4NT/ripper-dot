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
      <p><b>Conexão não oficial.</b> A sessão lida pelo QR dá controle total do número, e a Meta pode banir números que usam cliente não oficial. Por isso o agente <b>só responde números da lista</b>, nunca inicia conversa, tem limite por hora e roda sem computador, navegador e plugins. Use um número dedicado ao atendimento.</p>
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
    <Row title="Números permitidos" desc="Um por linha, com DDI e DDD (ex.: +55 11 98888-7777). Quem não está aqui é ignorado e a mensagem não é guardada." stack>
      <textarea className="input wa-allow" rows={4} value={(w.allowlist || []).join('\n')} placeholder={'+55 11 98888-7777\n+55 21 97777-6666'}
        onChange={e => setW('allowlist', e.target.value.split('\n'))} />
      <small className="muted">{(w.allowlist || []).filter(n => n.replace(/\D/g, '').length >= 10).length} número(s) válido(s)</small>
    </Row>
  </>;
}
