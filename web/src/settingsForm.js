import { useEffect, useState } from 'react';
import { api } from './lib.js';
import { useApp } from './app.jsx';

/** Cópia editável das configurações globais, com "salvar" e "descartar". */
export function useSettingsDraft() {
  const { S, refresh, toast } = useApp();
  const [s, setS] = useState(() => structuredClone(S.settings));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(S.settings);
  useEffect(() => {
    if (!dirty) return;
    const f = e => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', f); return () => removeEventListener('beforeunload', f);
  }, [dirty]);
  const set = (path, value) => setS(x => {
    const n = structuredClone(x);
    const parts = path.split('.');
    if (parts.length === 1) n[parts[0]] = value;
    else {
      if (!n[parts[0]] || typeof n[parts[0]] !== 'object') n[parts[0]] = {};
      n[parts[0]][parts[1]] = value;
    }
    return n;
  });
  async function save(extra) {
    setSaving(true);
    try { await api('/api/settings', { method: 'PUT', body: extra ? { ...s, ...extra } : s }); await refresh(); toast('Configurações salvas'); }
    catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  }
  return { s, set, setS, dirty, saving, save, reset: () => setS(structuredClone(S.settings)) };
}
