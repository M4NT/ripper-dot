import { useState } from 'react';
import { Icon } from './ui.jsx';
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
