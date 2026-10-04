// Entrega de arquivo do computador do agente para a conversa (botões Abrir / Baixar / Mostrar na pasta).
// O arquivo não é copiado: /work e /shared da VM já moram em data/sandbox/<agente>/ e data/shared/.
import { posix } from 'node:path';

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', log: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', zip: 'application/zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4'
};

export function mimeOf(name) {
  return MIME[String(name).toLowerCase().split('.').pop()] || 'application/octet-stream';
}

/**
 * Caminho dentro da VM → caminho relativo à pasta de dados do Ripper. null = fora do permitido.
 * Aceita /work/x, x (relativo a /work) e /shared/x. Recusa ".." e qualquer outro absoluto.
 */
export function vmPathToData(vmPath, agentId) {
  const raw = String(vmPath || '').trim().replace(/\\/g, '/');
  if (!raw || raw.includes('\0')) return null;
  const abs = raw.startsWith('/') ? posix.normalize(raw) : posix.normalize('/work/' + raw);
  if (abs.split('/').includes('..')) return null;
  if (abs.startsWith('/work/')) return `sandbox/${agentId}/${abs.slice('/work/'.length)}`;
  if (abs.startsWith('/shared/')) return `shared/${abs.slice('/shared/'.length)}`;
  return null;
}

/** Tipos que o navegador mostra com segurança numa aba (HTML/SVG viram texto: mesmo domínio do Ripper). */
export function inlineType(type) {
  if (/^image\/(png|jpe?g|webp|gif)$/.test(type) || type === 'application/pdf') return type;
  if (/^text\//.test(type) || type === 'application/json' || type === 'image/svg+xml') return 'text/plain; charset=utf-8';
  return null;
}
