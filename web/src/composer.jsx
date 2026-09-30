import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VoiceBeam, useMicrophone } from 'voice-glow';
import { Liquid } from 'liquid-gooey';
import { api, fmtSize, local, useDark } from './lib.js';
import { AgentAvatar, Icon, useToast } from './ui.jsx';
import ModelPicker from './modelPicker.jsx';

const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

/** Envia arquivos para o agente e devolve os registros criados. */
export async function uploadFile(agentId, chatId, file, projectId) {
  if (file.size > 25 << 20) throw new Error(`${file.name} passa de 25 MB.`);
  const qs = new URLSearchParams({ name: file.name, ...(agentId ? { agentId } : {}), ...(chatId ? { chatId } : {}), ...(projectId ? { projectId } : {}) });
  return api('/api/files?' + qs, { method: 'POST', raw: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
}

export default function Composer({ agent, chatId, projectId, mentions, streaming, onSend, onStop, choice, setChoice, group, placeholder, autoFocus, draftKey }) {
  const toast = useToast();
  const [text, setText] = useState(() => local.get('draft.' + draftKey, ''));
  const [files, setFiles] = useState([]); // { key, name, size, file?, id?, status }
  const [plus, setPlus] = useState(false);
  const [listening, setListening] = useState(false);
  const ta = useRef(null), fileInput = useRef(null), rec = useRef(null), base = useRef('');
  const mic = useMicrophone();
  const resolvedTheme = useDark() ? 'dark' : 'light';

  useLayoutEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 260) + 'px'; }, [text]);
  useEffect(() => { local.set('draft.' + draftKey, text); }, [text, draftKey]);
  useEffect(() => () => { rec.current?.abort(); mic.stop(); }, []);

  const uploading = files.some(f => f.status === 'uploading');
  const canSend = !streaming && !uploading && (text.trim().length > 0 || files.some(f => f.id));

  async function addFiles(list) {
    setPlus(false);
    for (const file of list) {
      const key = Math.random().toString(36).slice(2);
      const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setFiles(fs => [...fs, { key, name: file.name, size: file.size, type: file.type, url, status: 'uploading' }]);
      try {
        const rec = await uploadFile(agent.id, chatId, file, projectId);
        setFiles(fs => fs.map(f => f.key === key ? { ...f, id: rec.id, status: 'ready' } : f));
      } catch (e) {
        toast(e.message, 'error');
        setFiles(fs => fs.filter(f => f.key !== key));
      }
    }
  }

  function send() {
    if (!canSend) return;
    const ready = files.filter(f => f.id);
    onSend({ text: text.trim(), fileIds: ready.map(f => f.id), previews: ready.map(f => ({ id: f.id, name: f.name, type: f.type, url: f.url || `/api/files/${f.id}` })) });
    setText(''); setFiles([]);
    if (listening) toggleVoice();
  }

  // Ditado: o reconhecimento de fala escreve no campo; o microfone alimenta o brilho.
  async function toggleVoice() {
    if (listening) { rec.current?.stop(); mic.stop(); setListening(false); return; }
    if (!SpeechRec) return toast('Este navegador não faz ditado. Use Chrome ou Edge.', 'error');
    const stream = await mic.start();
    if (!stream) return toast('Sem acesso ao microfone. Libere nas permissões do navegador.', 'error');
    const r = new SpeechRec();
    r.lang = 'pt-BR'; r.interimResults = true; r.continuous = true;
    base.current = text ? text.replace(/\s*$/, ' ') : '';
    r.onresult = e => {
      let finalT = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (finalT += e.results[i][0].transcript) : (interim += e.results[i][0].transcript));
      if (finalT) base.current += finalT;
      setText(base.current + interim);
    };
    r.onend = () => { setListening(false); mic.stop(); };
    r.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('O ditado parou: ' + e.error, 'error'); };
    rec.current = r; r.start(); setListening(true);
  }


  return (
    <div className="composer-wrap">
      <VoiceBeam stream={listening ? mic.stream : null} processing={streaming && !listening} active={listening || streaming} idle={0}
        colorVariant="mono" theme={resolvedTheme} borderRadius={22} className="composer-voice">
          <form className="composer" onSubmit={e => { e.preventDefault(); streaming ? onStop() : send(); }}
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag'); }}
            onDragLeave={e => e.currentTarget.classList.remove('drag')}
            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag'); addFiles([...e.dataTransfer.files]); }}>
            {mentions && (() => {
              // Sugestões de @menção enquanto a palavra atual começa com @.
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
            <textarea ref={ta} rows={1} value={text} autoFocus={autoFocus} placeholder={listening ? 'Ouvindo…' : placeholder}
              aria-label="Mensagem" onChange={e => setText(e.target.value)}
              onPaste={e => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); addFiles(fs); } }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } if (e.key === 'Escape' && streaming) onStop(); }} />
            <div className="composer-row">
              {/* Menu + que se divide em gotas (liquid-gooey, morph) */}
              <Liquid className="plus-liquid" fill="var(--chip)" blur={6} contrast={18} shadow="0 1px 2px rgba(20,18,15,.08)">
                <Liquid.Item x={0} y={0}>
                  <button type="button" className={`round round-main ${plus ? 'open' : ''}`} aria-expanded={plus} aria-label={plus ? 'Fechar opções' : 'Mais opções'} onClick={() => setPlus(p => !p)}><Icon name="plus" size={17} /></button>
                </Liquid.Item>
                <Liquid.Item x={plus ? 42 : 0} y={0} transition="bouncy" delay={20}>
                  <button type="button" className={`round ${plus ? "" : "tucked"}`} tabIndex={plus ? 0 : -1} aria-hidden={!plus} aria-label="Anexar arquivo" onClick={() => fileInput.current.click()}><Icon name="paperclip" size={16} /></button>
                </Liquid.Item>
              </Liquid>
              <input ref={fileInput} type="file" multiple hidden onChange={e => { addFiles([...e.target.files]); e.target.value = ''; }} />
              <div className={`composer-chips ${plus ? 'shifted' : ''}`}>
                {setChoice && <ModelPicker value={choice} onChange={setChoice} group={group} />}
              </div>
              <div className="grow" />
              {SpeechRec && (
                <button type="button" className={`icon-btn mic ${listening ? 'live' : ''}`} aria-pressed={listening} aria-label={listening ? 'Parar ditado' : 'Ditar mensagem'} onClick={toggleVoice}><Icon name="mic" /></button>
              )}
                <button className={`send ${streaming ? 'stop' : ''}`} disabled={!canSend && !streaming} aria-label={streaming ? 'Parar resposta' : 'Enviar'}>
                  <Icon name={streaming ? 'stop' : 'arrowUp'} size={17} />
                </button>
            </div>
          </form>
      </VoiceBeam>
    </div>
  );
}
