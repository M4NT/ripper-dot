import { useEffect, useState } from 'react';
import { api } from './lib.js';
import { useApp } from './app.jsx';
import { useT } from './i18n/index.jsx';

/** Cópia editável das configurações globais, com "salvar" e "descartar". */
export function useSettingsDraft() {
  const { S, refresh, toast } = useApp();
  const t = useT();
  const [s, setS] = useState(() => structuredClone(S.settings));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(S.settings);
  useEffect(() => {
    if (!dirty) return;
    const f = e => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', f); return () => removeEventListener('beforeunload', f);
  }, [dirty]);
  const set = (path, value) => setS(x => {
    const n = structuredClone(x); const [a, b] = path.split('.');
    if (b) { if (!n[a] || typeof n[a] !== 'object') n[a] = {}; n[a][b] = value; }
    else n[a] = value;
    return n;
  });
  async function save(extra) {
    setSaving(true);
    try { await api('/api/settings', { method: 'PUT', body: extra ? { ...s, ...extra } : s }); await refresh(); toast(t('settings.savedToast')); }
    catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  }
  return { s, set, setS, dirty, saving, save, reset: () => setS(structuredClone(S.settings)) };
}
