import { useEffect, useState } from 'react';
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
const IMG = /^image\/(png|jpe?g|webp|gif)$/;

export function DeliveredFiles({ items, onError }) {
  const act = async (f, mode) => {
    try { await api(`/api/files/${f.id}/${mode}`, { method: 'POST' }); }
    catch (e) { onError?.(e.message); }
  };
  // Várias imagens (carrossel, variações de arte): lado a lado, na ordem; o resto segue em lista.
  const imgs = items.filter(f => IMG.test(f.type || ''));
  const gallery = imgs.length > 1;
  const rest = gallery ? items.filter(f => !imgs.includes(f)) : items;
  return (
    <>
    {gallery && (
      <div className="delivered-gallery" aria-label={`${imgs.length} imagens`}>{imgs.map((f, i) => (
        <a key={f.id} className="delivered-thumb" href={`/api/files/${f.id}?view=1`} target="_blank" rel="noopener" title={f.name}>
          <img src={`/api/files/${f.id}?view=1`} alt={f.name} loading="lazy" decoding="async" />
          <span>{i + 1}</span>
        </a>
      ))}</div>
    )}
    {rest.length > 0 && <ul className="delivered">{rest.map(f => {
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
          <FilePreview file={f} />
        </li>
      );
    })}</ul>}
    </>
  );
}

/** Prévia na conversa: imagem, PDF e CSV (tabela). Demais tipos só pelos botões. */
function FilePreview({ file: f }) {
  const src = `/api/files/${f.id}?view=1`;
  if (/^image\/(png|jpe?g|webp|gif)$/.test(f.type || '')) return <img className="delivered-preview" src={src} alt={f.name} loading="lazy" decoding="async" />;
  if (f.type === 'application/pdf') return <iframe className="delivered-preview delivered-pdf" src={src} title={`Prévia de ${f.name}`} loading="lazy" />;
  if (f.type === 'text/csv' || /\.csv$/i.test(f.name)) return <CsvPreview src={src} />;
  return null;
}

// ponytail: separador simples (vírgula ou ponto e vírgula, aspas sem quebra de linha); 20 linhas.
function CsvPreview({ src }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let on = true;
    fetch(src).then(r => r.text()).then(t => {
      const lines = t.split(/\r?\n/).filter(Boolean).slice(0, 21);
      const sep = (lines[0]?.split(';').length || 0) > (lines[0]?.split(',').length || 0) ? ';' : ',';
      const cell = c => c.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"');
      if (on) setRows(lines.map(l => l.split(new RegExp(`${sep}(?=(?:[^"]*"[^"]*")*[^"]*$)`)).map(cell)));
    }).catch(() => {});
    return () => { on = false; };
  }, [src]);
  if (!rows?.length) return null;
  const [head, ...body] = rows;
  return (
    <div className="delivered-preview delivered-table">
      <table>
        <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
