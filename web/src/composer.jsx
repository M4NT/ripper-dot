import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VoiceBeam, useMicrophone } from 'voice-glow';
import { api, fmtSize, go, local, useDark } from './lib.js';
import { AgentAvatar, Icon, useToast } from './ui.jsx';
import { useApp } from './app.jsx';
import { isEnterpriseMode } from './uiMode.js';
import ModelPicker from './modelPicker.jsx';
import ComposerPlusMenu from './composerPlusMenu.jsx';
import BlindCredentialInput from './vault/BlindCredentialInput.jsx';
import { sessionPayload } from './marketplace/sessionMcp.js';

const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

/** Envia arquivos para o agente e devolve os registros criados. */
export async function uploadFile(agentId, chatId, file, projectId, { batch } = {}) {
  if (file.size > 25 << 20) throw new Error(`${file.name} passa de 25 MB.`);
  const qs = new URLSearchParams({ name: file.name, ...(agentId ? { agentId } : {}), ...(chatId ? { chatId } : {}), ...(projectId ? { projectId } : {}), ...(batch ? { batch: String(batch) } : {}) });
  return api('/api/files?' + qs, { method: 'POST', raw: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
}

export default function Composer({ agent, chatId, projectId, mentions, streaming, onSend, onStop, choice, setChoice, group, placeholder, autoFocus, draftKey }) {
  const { S } = useApp();
  const toast = useToast();
  const [text, setText] = useState(() => local.get('draft.' + draftKey, ''));
  const [files, setFiles] = useState([]); // { key, name, size, file?, id?, status }
  const [plus, setPlus] = useState(false);
  const [credentials, setCredentials] = useState([]); // { ref, label }
  const [credOpen, setCredOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const ta = useRef(null), fileInput = useRef(null), folderInput = useRef(null), plusBtn = useRef(null), rec = useRef(null), base = useRef(''), spoke = useRef(false); // spoke: a mensagem teve trecho ditado
  const mic = useMicrophone();
  const resolvedTheme = useDark() ? 'dark' : 'light';

  useLayoutEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 260) + 'px'; }, [text]);
  useEffect(() => { local.set('draft.' + draftKey, text); }, [text, draftKey]);
  useEffect(() => () => { const r = rec.current; r?.abort ? r.abort() : r?.state === 'recording' && r.stop(); mic.stop(); }, []);

  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') { e.preventDefault(); fileInput.current?.click(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const uploading = files.some(f => f.status === 'uploading');
  const canSend = !streaming && !uploading && (text.trim().length > 0 || files.some(f => f.id) || credentials.length > 0);

  async function addFiles(list) {
    setPlus(false);
    const batch = list.length;
    for (const file of list) {
      const key = Math.random().toString(36).slice(2);
      const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setFiles(fs => [...fs, { key, name: file.name, size: file.size, type: file.type, url, status: 'uploading' }]);
      try {
        const rec = await uploadFile(agent.id, chatId, file, projectId, { batch });
        setFiles(fs => fs.map(f => f.key === key ? { ...f, id: rec.id, status: 'ready' } : f));
      } catch (e) {
        toast(e.message, 'error');
        setFiles(fs => fs.filter(f => f.key !== key));
      }
    }
  }

  const intentionalRef = useRef(false);

  function sendFromComposer(immediate = false) {
    if (!canSend) return;
    const ready = files.filter(f => f.id);
    const credRefs = credentials.map(c => c.ref);
    const credNote = credentials.length
      ? `\n\n[${credentials.map(c => `${c.label} (${c.ref})`).join('; ')}]`
      : '';
    onSend({
      text: (text.trim() + credNote).trim() || (credentials.length ? 'Use as credenciais guardadas no cofre conforme necessário.' : ''),
      fileIds: ready.map(f => f.id),
      previews: ready.map(f => ({ id: f.id, name: f.name, type: f.type, url: f.url || `/api/files/${f.id}` })),
      credentialRefs: credRefs,
      mcpSession: sessionPayload(),
      voice: spoke.current && !!text.trim()
    }, { immediate });
    spoke.current = false;
    setText(''); setFiles([]); setCredentials([]); setCredOpen(false);
    if (listening) toggleVoice();
  }

  async function toggleVoice() {
    if (listening) { rec.current?.stop(); mic.stop(); setListening(false); return; }
    if (transcribing) return;
    const stream = await mic.start();
    if (!stream) return toast('Sem acesso ao microfone. Libere nas permissões do navegador.', 'error');
    if (!SpeechRec) {
      // Firefox, Safari e afins: grava e transcreve no Whisper local do Ripper.
      const chunks = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = e => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        mic.stop(); setListening(false);
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        if (blob.size < 1000) return;
        setTranscribing(true);
        try {
          const { text: said } = await api('/api/transcribe', { method: 'POST', raw: blob, headers: { 'content-type': blob.type } });
          if (said) { setText(t => (t ? t.replace(/\s*$/, ' ') : '') + said); spoke.current = true; ta.current?.focus(); }
        } catch (e) { toast(e.message, 'error'); }
        finally { setTranscribing(false); }
      };
      rec.current = r; r.start(); setListening(true);
      return;
    }
    const r = new SpeechRec();
    r.lang = 'pt-BR'; r.interimResults = true; r.continuous = true;
    base.current = text ? text.replace(/\s*$/, ' ') : '';
    r.onresult = e => {
      let finalT = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (finalT += e.results[i][0].transcript) : (interim += e.results[i][0].transcript));
      if (finalT) { base.current += finalT; spoke.current = true; }
      setText(base.current + interim);
    };
    r.onend = () => { setListening(false); mic.stop(); };
    r.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('O ditado parou: ' + e.error, 'error'); };
    rec.current = r; r.start(); setListening(true);
  }

  function openSlash() {
    const el = ta.current;
    if (el) {
      const v = text;
      const next = v.endsWith('/') || v.endsWith(' /') ? v : (v && !v.endsWith(' ') ? v + ' /' : v + '/');
      setText(next);
      el.focus();
    }
    window.dispatchEvent(new CustomEvent('ripper:open-palette'));
  }

  function teachTask() {
    if (!isEnterpriseMode(S.settings)) {
      toast('Criar skills fica no modo Enterprise — use o Marketplace para plugins.');
      go('/marketplace/discover');
      return;
    }
    local.set('skills.openCreate', true);
    go('/skills');
  }

  function pickFolder(e) {
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    addFiles(list);
    toast(`${list.length} arquivo(s) da pasta anexado(s).`);
  }

  return (
    <div className="composer-wrap">
      <VoiceBeam stream={listening ? mic.stream : null} processing={streaming && !listening} active={listening || streaming} idle={0}
        colorVariant="mono" theme={resolvedTheme} borderRadius={22} className="composer-voice">
          <form className="composer" onSubmit={e => { e.preventDefault(); if (streaming) onStop(); else { sendFromComposer(intentionalRef.current); intentionalRef.current = false; } }}
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag'); }}
            onDragLeave={e => e.currentTarget.classList.remove('drag')}
            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag'); addFiles([...e.dataTransfer.files]); }}>
            {mentions && (() => {
              const m = /(^|\s)@([\wÀ-ú]*)$/.exec(text);
              const opts = m ? mentions.filter(a => a.name.toLowerCase().startsWith(m[2].toLowerCase())) : [];
              return opts.length > 0 && (
                <div className="mention-menu" role="listbox" aria-label="Mencionar agente">
                  {opts.map(a => (
                    <button key={a.id} type="button" role="option" aria-selected="false" onMouseDown={e => { e.preventDefault(); setText(text.replace(/@([\wÀ-ú]*)$/, '@' + a.name + ' ')); ta.current?.focus(); }}>
                      <AgentAvatar agent={a} size={20} paused />{a.name}<small>{a.description || a.category}</small>
                    </button>
                  ))}
                </div>
              );
            })()}
            {credentials.length > 0 && (
              <div className="composer-cred-row">
                {credentials.map(c => (
                  <span key={c.ref} className="composer-cred-chip">
                    <Icon name="check" size={12} />{c.label}
                    <button type="button" aria-label="Remover credencial" onClick={() => setCredentials(cs => cs.filter(x => x.ref !== c.ref))}><Icon name="x" size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            {credOpen && (
              <div className="composer-cred-row">
                <BlindCredentialInput
                  label="Senha / token"
                  purpose="chat"
                  onVaultRef={ref => {
                    if (ref) {
                      setCredentials(cs => [...cs, { ref, label: 'Credencial guardada' }]);
                      setCredOpen(false);
                    }
                  }}
                />
              </div>
            )}
            {files.length > 0 && (
              <div className="attach-row">
                {files.map(f => (
                  <span key={f.key} className={`attach ${f.status} ${f.url ? 'attach-img' : ''}`}>
                    {f.url ? <img src={f.url} alt="" /> : <Icon name="file" size={14} />}<span className="attach-name">{f.name}</span><small>{f.status === 'uploading' ? 'enviando…' : fmtSize(f.size)}</small>
                    <button type="button" aria-label={`Remover ${f.name}`} onClick={() => { setFiles(fs => fs.filter(x => x.key !== f.key)); f.id && api(`/api/files/${f.id}`, { method: 'DELETE' }).catch(() => {}); }}><Icon name="x" size={13} /></button>
                  </span>
                ))}
              </div>
            )}
            <textarea ref={ta} rows={1} value={text} autoFocus={autoFocus} placeholder={listening ? 'Ouvindo…' : transcribing ? 'Transcrevendo…' : placeholder}
              aria-label="Mensagem" onChange={e => setText(e.target.value)}
              onPaste={e => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); addFiles(fs); } }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendFromComposer(false); } if (e.key === 'Escape' && streaming) onStop(); }} />
            <div className="composer-row">
              <button ref={plusBtn} type="button" className={`round-btn ${plus ? 'open' : ''}`} aria-expanded={plus} aria-label="Mais opções" onClick={() => setPlus(p => !p)}>
                <Icon name="plus" size={17} />
              </button>
              <ComposerPlusMenu open={plus} onClose={() => setPlus(false)} anchorRef={plusBtn}
                onFiles={() => fileInput.current?.click()}
                onFolder={() => folderInput.current?.click()}
                onSlash={openSlash}
                onTeach={teachTask}
                onCredential={() => { setPlus(false); setCredOpen(true); }} />
              <input ref={fileInput} type="file" multiple hidden accept="image/*,*/*" onChange={e => { addFiles([...e.target.files]); e.target.value = ''; }} />
              <input ref={folderInput} type="file" multiple hidden webkitdirectory="" directory="" onChange={pickFolder} />
              <div className="composer-chips">
                {setChoice && <ModelPicker value={choice} onChange={setChoice} group={group} chatId={chatId} />}
              </div>
              <div className="grow" />
              {(SpeechRec || typeof MediaRecorder !== 'undefined') && (
                <button type="button" className={`icon-btn mic ${listening ? 'live' : ''}`} aria-pressed={listening} aria-busy={transcribing} disabled={transcribing} aria-label={listening ? 'Parar ditado' : 'Ditar mensagem'} onClick={toggleVoice}><Icon name="mic" /></button>
              )}
                <button type="submit" className={`send ${streaming ? 'stop' : ''}`} disabled={!canSend && !streaming} aria-label={streaming ? 'Parar resposta' : 'Enviar'}
                  onPointerDown={() => { if (!streaming) intentionalRef.current = true; }}>
                  <Icon name={streaming ? 'stop' : 'arrowUp'} size={17} />
                </button>
            </div>
          </form>
      </VoiceBeam>
    </div>
  );
}
