// Contrato entre modelos: toda saída estruturada (JSON) passa por um esquema zod estrito.
// Falhou? Pede de novo uma vez, mostrando o erro; só então o chamador cai na heurística.

/** Primeiro objeto {...} balanceado (ou bloco ```json). */
function extractObject(text) {
  const s = String(text ?? '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const src = fence ? fence[1] : s;
  const start = src.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

/** Conserta variações simples: aspas tipográficas e vírgula sobrando antes de } ou ]. */
const repairJson = s => s.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1');

/** text → { ok, data, error }. error é curto e lista os campos ruins. */
export function parseModelJson(text, schema, { repair = true } = {}) {
  const blob = extractObject(text);
  if (!blob) return { ok: false, error: 'nenhum objeto JSON encontrado' };
  let raw;
  try { raw = JSON.parse(blob); } catch {
    if (!repair) return { ok: false, error: 'JSON inválido' };
    try { raw = JSON.parse(repairJson(blob)); } catch (e) { return { ok: false, error: `JSON inválido (${e.message})` }; }
  }
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const error = r.error.issues.slice(0, 6).map(i => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
  return { ok: false, error };
}

/** run(prompt) → texto. Uma nova tentativa (padrão) com o erro de validação devolvido ao modelo. */
export async function askWithContract({ run, prompt, schema, retries = 1 }) {
  let p = prompt, last;
  for (let i = 0; i <= retries; i++) {
    last = parseModelJson(await run(p), schema);
    if (last.ok) return { ...last, attempts: i + 1 };
    p = `${prompt}\n\nSua resposta anterior não seguiu o formato: ${last.error}. Responda só com o JSON corrigido.`;
  }
  return { ...last, attempts: retries + 1 };
}
