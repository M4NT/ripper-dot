import { useMemo, useState } from 'react';
import { fmtSize, fmtTime } from './lib.js';
import { Icon } from './ui.jsx';
import FileThumb from './fileThumb.jsx';
import MediaLightbox from './MediaLightbox.jsx';
import { fileApiUrl, isImage } from './media.js';

/**
 * Galeria compacta + lista de arquivos da conversa atual (painel lateral).
 */
export default function ConversationMedia({ files, onRemove, canUpload, onAdd, emptyHint }) {
  const [lightbox, setLightbox] = useState(null);
  const images = useMemo(() => files.filter(f => isImage(f.type)), [files]);
  return (
    <div className="panel-tab conv-media">
      {files.length === 0 && <p className="muted small">{emptyHint}</p>}

      {images.length > 0 && (
        <section className="conv-media-gallery" aria-label="Imagens da conversa">
          <p className="panel-label">Galeria ({images.length})</p>
          <ul className="media-grid">
            {images.map(f => (
              <li key={f.id}>
                <button type="button" className="media-grid-btn" onClick={() => setLightbox(f)} aria-label={`Abrir ${f.name}`}>
                  <FileThumb src={fileApiUrl(f.id)} alt={f.name} size={72} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {files.length > 0 && (
        <section className="conv-media-list" aria-label="Todos os arquivos">
          <p className="panel-label">{images.length ? 'Todos os arquivos' : 'Arquivos'}</p>
          <ul className="file-list">
            {files.map(f => (
              <li key={f.id}>
                {isImage(f.type)
                  ? <button type="button" className="thumb-btn" onClick={() => setLightbox(f)} aria-label={`Abrir ${f.name}`}><FileThumb src={fileApiUrl(f.id)} alt={f.name} /></button>
                  : <span className="thumb file-ico"><Icon name="file" size={18} /></span>}
                {isImage(f.type)
                  ? <button type="button" className="row-link" onClick={() => setLightbox(f)}><b>{f.name}</b><small>{fmtSize(f.size)} · {fmtTime(f.createdAt)}</small></button>
                  : <a className="row-link" href={fileApiUrl(f.id)} download={f.name} rel="noopener"><b>{f.name}</b><small>{fmtSize(f.size)} · {fmtTime(f.createdAt)}</small></a>}
                <a className="icon-btn sm" href={fileApiUrl(f.id)} download={f.name} rel="noopener" aria-label={`Baixar ${f.name}`} title="Baixar"><Icon name="download" size={15} /></a>
                <button className="icon-btn sm" aria-label={`Remover ${f.name}`} onClick={() => onRemove(f)}><Icon name="trash" size={15} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button className="btn btn-block btn-ghost-line" onClick={onAdd} disabled={!canUpload}><Icon name="plus" size={16} />Adicionar arquivo</button>
      {!canUpload && <p className="muted small center">Envie a primeira mensagem para anexar aqui.</p>}
      {lightbox && <MediaLightbox file={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
