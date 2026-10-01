/** Tipos de imagem aceitos no chat e na galeria. */
export const isImage = t => /^image\/(png|jpe?g|webp|gif)$/.test(t || '');

/** URL da API para um arquivo persistido. */
export function fileApiUrl(id) {
  return id ? `/api/files/${id}` : '';
}

/** Resolve a URL de visualização (prévia local ou API). */
export function fileHref(file) {
  if (!file) return '';
  return file.url || fileApiUrl(file.id);
}

/** Nome seguro para o atributo download (mesma origem). */
export function downloadName(name) {
  const n = String(name || 'arquivo').replace(/[/\\?%*:|"<>]/g, '_').trim();
  return n || 'arquivo';
}

/** Limite visual das miniaturas no chat (px). */
export const CHAT_THUMB_MAX_W = 320;
export const CHAT_THUMB_MAX_H = 260;
export const CHAT_THUMB_SINGLE_MAX_W = 420;
export const CHAT_THUMB_SINGLE_MAX_H = 340;
