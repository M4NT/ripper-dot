import { useEffect, useState } from 'react';
import { api, go } from './lib.js';
import { Dialog } from './ui.jsx';
import { useApp } from './app.jsx';

const KEY = 'ripper.onboarded';
const seen = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };

const AI = [
  ['claude', 'Claude', 'Melhor qualidade para os agentes. Use sua assinatura: rode claude login uma vez nesta máquina.'],
  ['chatgpt', 'ChatGPT', 'Boa qualidade pela assinatura. Rode codex login uma vez nesta máquina.'],
  ['key', 'Chave de API', 'Mesma qualidade do Claude, mas cada resposta é cobrada na sua conta do provedor.'],
  ['none', 'Não tenho', 'Em breve: um modelo local que roda no seu computador, de graça. Qualidade menor e depende da sua máquina.']
];

/** Assistente de primeiro uso: aparece uma vez, depois do login, enquanto não há agente. */
export function FirstRunWizard() {
  const { S, refresh, toast } = useApp();
  const [open, setOpen] = useState(() => !seen() && S.agents.length === 0);
  const [step, setStep] = useState('ai');
  const [ai, setAi] = useState(null);
  const [key, setKey] = useState('');
  const [docker, setDocker] = useState(undefined);
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState(null);

  useEffect(() => { if (step === 'computer') api('/api/computer/docker').then(r => setDocker(r.version || null), () => setDocker(null)); }, [step]);
  if (!open) return null;

  const close = () => { try { localStorage.setItem(KEY, '1'); } catch {} setOpen(false); if (agentId) go(`/a/${agentId}`); };
  const saveSettings = body => api('/api/settings', { method: 'PUT', body }).then(refresh);
  const run = async fn => { setBusy(true); try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };

  const nextFromAi = () => run(async () => {
    if (ai === 'key') await saveSettings({ claude: { ...S.settings.claude, mode: 'api', apiKey: key.trim() } });
    setStep('computer');
  });
  const pickComputer = mode => run(async () => { await saveSettings({ computer: { ...S.settings.computer, mode } }); setStep('agent'); });
  const createAgent = () => run(async () => {
    const d = await api('/api/agents/draft', { method: 'POST', body: { text: sentence } });
    const a = await api('/api/agents', { method: 'POST', body: { name: d.name, description: d.description, category: d.category, instructions: d.instructions, tone: d.tone, tools: d.tools } });
    setAgentId(a.id); await refresh(); setStep('whatsapp');
  });

  return (
    <Dialog open onClose={close} className="confirm wizard" label="Primeiros passos">
      {step === 'ai' && <>
        <h2>Você tem conta de IA?</h2>
        <div className="wizard-options" role="radiogroup">
          {AI.map(([id, label, desc]) => (
            <button key={id} type="button" role="radio" aria-checked={ai === id} className={`wizard-option ${ai === id ? 'on' : ''}`} onClick={() => setAi(id)}>
              <b>{label}</b><small>{desc}</small>
            </button>
          ))}
        </div>
        {ai === 'key' && <input className="input" type="password" autoComplete="off" autoFocus placeholder="sk-ant-…" value={key} onChange={e => setKey(e.target.value)} />}
        {ai === 'none' && <p>Por enquanto, sem conta os agentes não respondem. Você pode seguir e voltar quando tiver uma.</p>}
        <div className="row end"><button className="btn" onClick={close}>Pular</button><button className="btn btn-primary" disabled={!ai || busy || (ai === 'key' && !key.trim())} onClick={nextFromAi}>Continuar</button></div>
      </>}

      {step === 'computer' && <>
        <h2>Computador dos agentes</h2>
        {docker === undefined ? <p role="status">Procurando o Docker…</p> : docker ? <>
          <p>Achamos o Docker {docker}. Cada agente ganha um computador isolado: roda comandos, abre navegador e cria arquivos.</p>
          <div className="row end"><button className="btn" disabled={busy} onClick={() => pickComputer('off')}>Sem computador</button><button className="btn btn-primary" disabled={busy} onClick={() => pickComputer('docker')}>Usar Docker</button></div>
        </> : <>
          <p>O Docker não está rodando. Sem ele, os agentes conversam, pesquisam na web e lembram, mas não rodam comandos, não abrem navegador nem criam arquivos. Dá para ligar depois em Configurações → Computador.</p>
          <div className="row end"><button className="btn btn-primary" disabled={busy} onClick={() => pickComputer('off')}>Seguir sem computador</button></div>
        </>}
      </>}

      {step === 'agent' && <>
        <h2>Seu primeiro agente</h2>
        <p>Diga numa frase o que ele faz e para quem.</p>
        <textarea className="input ask-input" rows={3} autoFocus value={sentence} onChange={e => setSentence(e.target.value)} placeholder="Ex.: responde dúvidas dos clientes da minha loja sobre prazos e trocas" />
        <div className="row end"><button className="btn" onClick={close}>Pular</button><button className="btn btn-primary" disabled={busy || sentence.trim().length < 8} onClick={createAgent}>{busy ? 'Criando…' : 'Criar agente'}</button></div>
      </>}

      {step === 'whatsapp' && <>
        <h2>WhatsApp (opcional)</h2>
        <p>Seu agente pode atender pelo WhatsApp. Conecte agora ou quando quiser.</p>
        <div className="row end"><button className="btn" onClick={close}>Agora não</button><a className="btn btn-primary" href="#/settings/channels" onClick={() => { try { localStorage.setItem(KEY, '1'); } catch {} setOpen(false); }}>Conectar WhatsApp</a></div>
      </>}
    </Dialog>
  );
}
