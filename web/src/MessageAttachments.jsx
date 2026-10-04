import { useState } from 'react';
import { Icon } from './ui.jsx';
import { api } from './lib.js';
import { downloadName, fileHref, isImage } from './media.js';
import MediaLightbox from './MediaLightbox.jsx';

function FileChip({ file }) {
  const url = fileHref(file);
  const name = file.name || 'Arquivo';
  if (!url) return null;
  return (
    <a href={url} download={downloadName(name)} rel="noopener" className="attach file-chip" title={`Baixar ${name}`}>
      <Icon name="file" size={14} />
      <span className="attach-name">{name}</span>
      <Icon name="download" size={14} className="file-chip-dl" aria-hidden="true" />
    </a>
  );
}

/** Imagens e arquivos de uma mensagem do usuário (com lightbox nas imagens). */
export default function MessageAttachments({ items }) {
  const [lightbox, setLightbox] = useState(null);
  const imgs = items.filter(f => isImage(f.type));
  const others = items.filter(f => !isImage(f.type));

  return (
    <>
      {imgs.length > 0 && (
        <div className={`msg-images ${imgs.length === 1 ? 'single' : ''}`}>
          {imgs.map(f => {
            const url = fileHref(f);
            const name = f.name || 'Imagem';
            return (
              <button key={f.id || url} type="button" className="msg-image" onClick={() => setLightbox(f)}
                aria-label={`Abrir imagem: ${name}`}>
                <img src={url} alt={name} loading="lazy" decoding="async" />
              </button>
            );
          })}
        </div>
      )}
      {others.length > 0 && (
        <div className="msg-files">{others.map(f => <FileChip key={f.id || fileHref(f)} file={f} />)}</div>
      )}
      {lightbox && <MediaLightbox file={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

export { FileChip };

const VIEWABLE = /^(image\/(png|jpe?g|webp|gif)|application\/pdf|text\/|application\/json)/;
const KIND = [[/wordprocessing|msword/, 'Documento Word'], [/spreadsheet|ms-excel|text\/csv/, 'Planilha'], [/presentation/, 'Apresentação'], [/pdf/, 'PDF'], [/^image\//, 'Imagem'], [/^text\//, 'Texto'], [/zip/, 'Arquivo compactado']];
const kindOf = type => (KIND.find(([re]) => re.test(type || '')) || [, 'Arquivo'])[1];
const fmtSize = n => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Arquivo que o agente entregou: Abrir (aba ou programa do computador), Baixar e Mostrar na pasta. */
export function DeliveredFiles({ items, onError }) {
  const act = async (f, mode) => {
    try { await api(`/api/files/${f.id}/${mode}`, { method: 'POST' }); }
    catch (e) { onError?.(e.message); }
  };
  return (
    <ul className="delivered">{items.map(f => {
      const viewable = VIEWABLE.test(f.type || '');
      return (
        <li key={f.id} className="delivered-file">
          <span className="delivered-ico"><Icon name="file" size={18} /></span>
          <span className="delivered-text"><b title={f.name}>{f.name}</b><small>{kindOf(f.type)}{f.size ? ` · ${fmtSize(f.size)}` : ''}</small></span>
          <span className="delivered-actions">
            {viewable
              ? <a className="btn btn-sm btn-primary" href={`/api/files/${f.id}?view=1`} target="_blank" rel="noopener">Abrir</a>
              : <button type="button" className="btn btn-sm btn-primary" onClick={() => act(f, 'open')}>Abrir</button>}
            <a className="btn btn-sm" href={`/api/files/${f.id}`} download={f.name}><Icon name="download" size={14} />Baixar</a>
            <button type="button" className="btn btn-sm" onClick={() => act(f, 'reveal')}>Mostrar na pasta</button>
          </span>
        </li>
      );
    })}</ul>
  );
}
