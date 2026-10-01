/**
 * Embeddings locais sem provedor pago: feature hashing em vetor denso + cosine.
 * Julia-1 no sidecar é classificador (/choose), não expõe /embed; se no futuro houver
 * um endpoint local de embeddings, semantic-cache.mjs pode delegar via settings.
 */
import { createHash } from 'node:crypto';

export const DEFAULT_EMBED_DIM = 256;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashToken(token, dims) {
  const h = createHash('sha256').update(token).digest();
  const idx = h.readUInt32BE(0) % dims;
  const sign = h[4] & 1 ? 1 : -1;
  return { idx, sign };
}

/**
 * @param {string} text
 * @param {number} [dims]
 * @returns {number[]}
 */
export function embedText(text, dims = DEFAULT_EMBED_DIM) {
  const vec = new Float32Array(dims);
  const norm = normalize(text);
  if (!norm) return Array.from(vec);
  const words = norm.split(' ');
  for (let i = 0; i < words.length; i++) {
    const unigram = words[i];
    const { idx, sign } = hashToken(unigram, dims);
    vec[idx] += sign;
    if (i < words.length - 1) {
      const bigram = `${unigram} ${words[i + 1]}`;
      const h2 = hashToken(bigram, dims);
      vec[h2.idx] += h2.sign * 0.5;
    }
  }
  let normL2 = 0;
  for (let i = 0; i < dims; i++) normL2 += vec[i] * vec[i];
  normL2 = Math.sqrt(normL2) || 1;
  for (let i = 0; i < dims; i++) vec[i] /= normL2;
  return Array.from(vec);
}

/** @param {number[]} a @param {number[]} b */
export function cosineSimilarity(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Texto canônico para comparar pergunta + contexto recente. */
export function cacheComparableText(question, context = '') {
  const q = normalize(question);
  const c = normalize(context).slice(-1500);
  return c ? `${q}\n---\n${c}` : q;
}
