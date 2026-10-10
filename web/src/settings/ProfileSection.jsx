import { useEffect, useState } from 'react';
import { api } from '../lib.js';
import { Switch } from '../ui.jsx';
import { TONES, FORMALITIES } from '../lib.js';
import { Card, Row } from './shared.jsx';

/** Notificações no celular (Web Push) para aprovações e avisos da Caixa. */
function PushCard() {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const usable = supported && window.isSecureContext;
  const [status, setStatus] = useState(!supported ? 'Este navegador não suporta notificações.' : !usable ? 'Precisa de HTTPS para funcionar aqui.' : '');
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!usable) return;
    navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(sub => {
      const ok = !!sub && Notification.permission === 'granted';
      setOn(ok);
      setStatus(ok ? 'Ativadas neste aparelho.' : Notification.permission === 'denied' ? 'Bloqueadas no navegador. Libere nas permissões do site.' : 'Desativadas neste aparelho.');
    }).catch(() => {});
  }, []);
  const enable = async () => {
    try {
      if (await Notification.requestPermission() !== 'granted') return setStatus('Permissão negada. Libere nas permissões do site.');
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api('/api/push/key');
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      setOn(true); setStatus('Ativadas neste aparelho.');
    } catch (e) { setStatus(`Não deu para ativar: ${e.message}`); }
  };
  const disable = async () => {
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      setOn(false); setStatus('Desativadas neste aparelho.');
    } catch (e) { setStatus(e.message); }
  };
  const test = () => api('/api/push/test', { method: 'POST' }).then(() => setStatus('Teste enviado. Deve chegar em segundos.'), e => setStatus(e.message));
  return (
    <Card title="Notificações neste aparelho" desc="Avisa quando um agente precisa da sua aprovação, quando há alerta do sistema ou quando um limite de uso é atingido.">
      <Row title="Notificações" desc={status}>
        {usable && (on
          ? <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-sm" onClick={test}>Enviar teste</button><button className="btn btn-sm" onClick={disable}>Desativar</button></div>
          : <button className="btn btn-sm btn-primary" onClick={enable}>Ativar</button>)}
      </Row>
      <small style={{ opacity: 0.7 }}>No celular, abra o Ripper por um endereço HTTPS (ou instale a partir dele): por http num IP da rede local não funciona. No computador, localhost funciona. No iPhone, adicione à tela inicial antes.</small>
    </Card>
  );
}

/** Celular na mesma rede: liga o acesso pelo Wi-Fi, mostra o QR de pareamento e lista os aparelhos. */
/** Celular fora de casa pelo Tailscale: rede privada entre os seus aparelhos, sem abrir portas no roteador. */
function AwayCard() {
  const [st, setSt] = useState(null);
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/api/pair').then(setSt, e => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (!st?.local) return null;
  const t = st.tail || {};
  const run = p => p.then(() => setErr(''), e => setErr(e.message));
  const toggle = on => run(api('/api/pair/tailscale', { method: 'POST', body: { on } }).then(() => { if (!on) setQr(null); return load(); }));
  return (
    <Card title="Celular fora de casa" desc="Use o Ripper no 4G ou em outro Wi-Fi, com segurança, pelo Tailscale (grátis para uso pessoal). Só os seus aparelhos enxergam o Ripper.">
      <ol className="steps-list">
        <li className={t.address ? 'done' : ''}>Instale o <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale</a> neste computador e entre com a sua conta. {t.address ? <b>Encontrado ({t.address}).</b> : <span className="muted">Ainda não encontrado.</span>}</li>
        <li>Instale o Tailscale no celular e entre com a <b>mesma conta</b>.</li>
        <li>Ligue o acesso abaixo e leia o QR Code com o celular.</li>
      </ol>
      <Row title="Acesso fora de casa" desc={t.error || (t.on ? `Aberto no Tailscale em ${t.address}.` : 'Desligado.')}>
        <button className={`btn btn-sm ${t.on ? '' : 'btn-primary'}`} disabled={!t.address && !t.on} onClick={() => toggle(!t.on)}>{t.on ? 'Desligar' : 'Ligar'}</button>
      </Row>
      {t.on && (
        <Row title="Parear o celular" desc={qr ? 'Vale por 10 minutos e uma só vez.' : 'Funciona de qualquer lugar com o Tailscale ligado no celular.'} stack={!!qr}>
          {qr
            ? <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
                <div style={{ width: 220, background: '#fff', borderRadius: 8 }} role="img" aria-label="QR Code para fora de casa" dangerouslySetInnerHTML={{ __html: qr.svg }} />
                <button className="btn btn-sm" onClick={() => run(api('/api/pair/invite?via=tailscale', { method: 'POST' }).then(setQr))}>Gerar outro</button>
              </div>
            : <button className="btn btn-sm btn-primary" onClick={() => run(api('/api/pair/invite?via=tailscale', { method: 'POST' }).then(setQr))}>Mostrar QR Code</button>}
        </Row>
      )}
      {err && <p className="small warn-text">{err}</p>}
    </Card>
  );
}

function DevicesCard() {
  const [st, setSt] = useState(null);
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/api/pair').then(setSt, e => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!qr) return;
    const t = setTimeout(() => setQr(null), qr.expiresAt - Date.now());
    return () => clearTimeout(t);
  }, [qr]);
  const run = p => p.then(() => setErr(''), e => setErr(e.message));
  const toggleLan = on => run(api('/api/pair/lan', { method: 'POST', body: { on } }).then(() => { if (!on) setQr(null); return load(); }));
  const newQr = () => run(api('/api/pair/invite', { method: 'POST' }).then(setQr));
  const drop = id => run(api(`/api/pair/devices/${id}`, { method: 'DELETE' }).then(load));
  if (!st) return null;
  const { lan, devices, local } = st;
  return (
    <Card title="Celular na mesma rede" desc="Abra o Ripper no celular pelo Wi-Fi de casa, sem digitar senha: gere o QR Code aqui e aponte a câmera.">
      {local && (
        <Row title="Acesso pela rede Wi-Fi" desc={lan.fixed ? 'Aberto pela variável HOST.' : lan.error || (lan.on ? `Aberto em ${lan.address}.` : 'Desligado: só este computador acessa.')}>
          {!lan.fixed && <button className={`btn btn-sm ${lan.on ? '' : 'btn-primary'}`} onClick={() => toggleLan(!lan.on)}>{lan.on ? 'Desligar' : 'Ligar'}</button>}
        </Row>
      )}
      {local && lan.on && (
        <Row title="Parear um celular" desc={qr ? `Vale por 10 minutos e uma só vez. Gerar outro cancela este.` : 'O convite expira em 10 minutos.'} stack={!!qr}>
          {qr
            ? <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
                <div style={{ width: 220, background: '#fff', borderRadius: 8 }} role="img" aria-label="QR Code de pareamento" dangerouslySetInnerHTML={{ __html: qr.svg }} />
                <button className="btn btn-sm" onClick={newQr}>Gerar outro</button>
              </div>
            : <button className="btn btn-sm btn-primary" onClick={newQr}>Mostrar QR Code</button>}
        </Row>
      )}
      <Row title="Aparelhos pareados" desc={devices.length ? null : 'Nenhum ainda.'} stack={devices.length > 0}>
        {devices.length > 0 && (
          <ul className="rows flat">{devices.map(d => (
            <li key={d.id} className="row-item">
              <div className="row-main"><b>{d.name}</b><small className="muted"> · pareado em {new Date(d.createdAt).toLocaleDateString()}</small></div>
              <button className="btn btn-sm" onClick={() => drop(d.id)}>Desconectar este aparelho</button>
            </li>
          ))}</ul>
        )}
      </Row>
      {err && <small className="error">{err}</small>}
      <small style={{ opacity: 0.7 }}>Na mesma rede a conexão é direta, por http. Fora de casa e cifrado de ponta a ponta vem numa próxima versão.</small>
    </Card>
  );
}

export default function ProfileSection({ s, set }) {
  return (
    <>
      <Card>
        <Row title="Seu nome" desc="Os agentes usam isso quando falam com você."><input className="input" value={s.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder="Ex.: Rafael" /></Row>
        <Row stack title="Instruções gerais" desc="Valem para todos os agentes, em toda conversa, junto com as instruções de cada um.">
          <textarea className="input" rows={6} value={s.customInstructions} maxLength={8000} onChange={e => set('customInstructions', e.target.value)} placeholder="Ex.: Sou dev frontend em SP. Respostas curtas, TypeScript no código." />
        </Row>
      </Card>
      <Card title="Voz padrão dos agentes" desc="Jeito de falar dos agentes que não têm um estilo próprio.">
        <Row title="Tom">
          <div className="pills">
            {TONES.map(([k, l]) => <button key={k} type="button" className={`pill ${(s.defaults?.agentStyle?.tone || 'direto') === k ? 'on' : ''}`} onClick={() => set('defaults', { ...s.defaults, agentStyle: { ...(s.defaults?.agentStyle || {}), tone: k } })}>{l}</button>)}
          </div>
        </Row>
        <Row title="Formalidade">
          <div className="pills">
            {FORMALITIES.map(([k, l]) => <button key={k} type="button" className={`pill ${(s.defaults?.agentStyle?.formality || 'neutro') === k ? 'on' : ''}`} onClick={() => set('defaults', { ...s.defaults, agentStyle: { ...(s.defaults?.agentStyle || {}), formality: k } })}>{l}</button>)}
          </div>
        </Row>
        <Row title="Dicas extras" stack>
          <textarea className="input" rows={2} maxLength={500} value={s.defaults?.agentStyle?.customHints || ''} onChange={e => set('defaults', { ...s.defaults, agentStyle: { ...(s.defaults?.agentStyle || {}), customHints: e.target.value } })} placeholder="Ex.: sempre em português do Brasil." />
        </Row>
      </Card>
      <PushCard />
      <DevicesCard />
      <AwayCard />
      <Card title="Resumo do dia" desc="Todo dia, na Caixa: o que cada agente fez, o que espera você e quanto gastou. Não gasta nada da sua assinatura.">
        <Row title="Receber o resumo"><Switch checked={s.pulse?.enabled !== false} onChange={v => set('pulse', { ...(s.pulse || {}), enabled: v })} label="Resumo do dia" /></Row>
        {s.pulse?.enabled !== false && <Row title="Horário">
          <select className="select" value={s.pulse?.hour ?? 8} onChange={e => set('pulse', { ...(s.pulse || {}), hour: +e.target.value })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </Row>}
        {s.pulse?.enabled !== false && (s.whatsappWeb?.enabled || s.whatsapp?.agentId) && <Row title="Também no meu WhatsApp" desc="Só para o seu próprio número, com DDI e DDD. Nunca vai para outra pessoa.">
          <Switch checked={!!s.pulse?.whatsapp} onChange={v => set('pulse', { ...(s.pulse || {}), whatsapp: v })} label="Resumo no WhatsApp" />
        </Row>}
        {s.pulse?.enabled !== false && s.pulse?.whatsapp && <Row title="Meu número">
          <input className="input" inputMode="tel" placeholder="+55 16 99999-9999" value={s.pulse?.whatsappTo || ''} onChange={e => set('pulse', { ...(s.pulse || {}), whatsappTo: e.target.value })} />
        </Row>}
      </Card>
    </>
  );
}
