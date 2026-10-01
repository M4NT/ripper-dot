import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui.jsx';
import { downloadName, fileHref } from './media.js';

/**
 * Visualização em tela cheia de uma imagem anexada.
 * Fecha com Esc ou clique no fundo; foco inicial no botão Fechar.
 */
export default function MediaLightbox({ file, onClose }) {
  const shell = useRef(null);
  const closeBtn = useRef(null);
  const url = fileHref(file);
  const name = file?.name || 'Imagem';

  useEffect(() => {
    const prev = document.activeElement;
    closeBtn.current?.focus();
    const root = document.documentElement;
    root.classList.add('lightbox-open');

    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !shell.current) return;
      const nodes = [...shell.current.querySelectorAll('button, a[href]')].filter(el => !el.disabled);
      if (nodes.length < 2) return;
      const i = nodes.indexOf(document.activeElement);
      if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      root.classList.remove('lightbox-open');
      if (prev?.focus) prev.focus();
    };
  }, [onClose]);

  if (!url) return null;

  return createPortal(
    <div className="media-lightbox" ref={shell} role="dialog" aria-modal="true" aria-label={name}>
      <button type="button" className="media-lightbox-scrim" aria-label="Fechar visualização" onClick={onClose} />
      <div className="media-lightbox-panel">
        <header className="media-lightbox-head">
          <span className="media-lightbox-title" title={name}>{name}</span>
          <div className="media-lightbox-actions">
            <a className="btn btn-sm" href={url} download={downloadName(name)} rel="noopener">Baixar</a>
            <button type="button" ref={closeBtn} className="icon-btn" aria-label="Fechar" onClick={onClose}><Icon name="x" size={18} /></button>
          </div>
        </header>
        <figure className="media-lightbox-body">
          <img src={url} alt={name} decoding="async" />
        </figure>
      </div>
    </div>,
    document.body
  );
}
