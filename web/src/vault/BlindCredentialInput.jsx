import { useRef, useState } from 'react';
import { Icon } from '../ui.jsx';
import { storeVaultCredential } from './vaultApi.js';

const SENSITIVE = /(authorization|api[-_]?key|token|secret|password|passwd|credential)/i;

export function isSensitiveFieldName(name) {
  return SENSITIVE.test(String(name || ''));
}

/**
 * Entrada cega: o valor não entra no estado React como texto legível após selar.
 * Devolve apenas a referência vlt_… para conectores ou mensagens.
 */
export default function BlindCredentialInput({
  label = 'Credencial',
  purpose = 'connector',
  placeholder = 'Senha ou token',
  vaultRef,
  onVaultRef,
  disabled
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function seal() {
    setErr('');
    const el = inputRef.current;
    const raw = el?.value || '';
    if (!raw.trim()) {
      setErr('Digite o valor antes de guardar no cofre.');
      return;
    }
    setBusy(true);
    try {
      const { ref } = await storeVaultCredential(raw, { label, purpose });
      if (el) el.value = '';
      onVaultRef?.(ref);
    } catch (e) {
      setErr(e.message || 'Não foi possível guardar no cofre.');
    }
    setBusy(false);
  }

  if (vaultRef) {
    return (
      <div className="blind-cred sealed">
        <Icon name="check" size={14} />
        <span className="blind-cred-label">{label}</span>
        <code className="blind-cred-ref">{vaultRef}</code>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => onVaultRef?.('')}>Trocar</button>
      </div>
    );
  }

  return (
    <div className="blind-cred">
      <input
        ref={inputRef}
        className="input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        disabled={disabled || busy}
        aria-label={label}
      />
      <button type="button" className="btn btn-sm btn-primary" disabled={disabled || busy} onClick={seal}>
        {busy ? 'Selando…' : 'Guardar no cofre'}
      </button>
      {err && <p className="form-error">{err}</p>}
      <small className="muted">Criptografado no navegador; o servidor e o modelo só veem a referência selada.</small>
    </div>
  );
}
