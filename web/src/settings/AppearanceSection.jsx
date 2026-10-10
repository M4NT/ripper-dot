import { useRef, useState } from 'react';
import { useApp } from '../app.jsx';
import { apiUpload, brandLogoSrc } from '../lib.js';
import { Icon, Select } from '../ui.jsx';
import { useT } from '../i18n/index.jsx';
import UiModeToggle from '../uiModeToggle.jsx';
import { isEnterpriseMode } from '../uiMode.js';
import { Card, Row } from './shared.jsx';

function BrandMarca({ s, set, toast }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const brand = s.brand || { displayName: '', logoUrl: '', accentColor: '', tagline: '', links: {} };
  const setBrand = (key, value) => set('brand', { ...brand, [key]: value });
  const setLink = (key, value) => set('brand', { ...brand, links: { ...(brand.links || {}), [key]: value } });
  const logoSrc = brandLogoSrc(brand.logoUrl);
  const previewName = brand.displayName?.trim() || 'Ripper';
  const previewStyle = brand.accentColor ? { '--brand-accent': brand.accentColor } : undefined;
  async function onLogoFile(file) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { logoUrl } = await apiUpload('/api/brand/logo', fd);
      setBrand('logoUrl', logoUrl);
      toast('Logo enviado — salve para aplicar');
    } catch (e) { toast(e.message, 'error'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  return <>
    <Card title="Marca" desc="Nome, logo e cor de destaque na barra lateral. Deixe em branco para o visual padrão do Ripper.">
      <div className="brand-preview" style={previewStyle}>
        {logoSrc
          ? <img className="brand-logo" src={logoSrc} width="40" height="40" alt="" />
          : <svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"><rect width="32" height="32" rx="8" className="brand-bg" /><path d="M11 23V9h6.2a4.3 4.3 0 0 1 .9 8.5L22 23" className="brand-r" /></svg>}
        <div><b>{previewName}</b>{brand.tagline?.trim() && <small className="muted">{brand.tagline.trim()}</small>}</div>
      </div>
      <Row title="Nome exibido" desc="Aparece no topo da barra lateral."><input className="input" value={brand.displayName || ''} maxLength={80} onChange={e => setBrand('displayName', e.target.value)} placeholder="Ripper" /></Row>
      <Row title="Tagline" desc="Opcional; só na prévia aqui (não na barra lateral)."><input className="input" value={brand.tagline || ''} maxLength={160} onChange={e => setBrand('tagline', e.target.value)} placeholder="Agentes de IA para o seu time" /></Row>
      <Row title="Cor de destaque" desc="Usada no ícone padrão quando não há logo.">
        <div className="row">
          <input className="input" type="color" value={/^#[0-9a-fA-F]{6}$/.test(brand.accentColor || '') ? brand.accentColor : '#161513'} onChange={e => setBrand('accentColor', e.target.value)} aria-label="Cor de destaque" />
          <input className="input" value={brand.accentColor || ''} onChange={e => setBrand('accentColor', e.target.value)} placeholder="#161513" style={{ maxWidth: 120 }} />
          {brand.accentColor && <button type="button" className="btn btn-sm" onClick={() => setBrand('accentColor', '')}>Padrão</button>}
        </div>
      </Row>
      <Row title="Logo" desc="URL pública (https) ou envie um arquivo (PNG, JPEG, WebP ou GIF, até 2 MB).">
        <div className="row stack">
          <input className="input" value={brand.logoUrl || ''} onChange={e => setBrand('logoUrl', e.target.value)} placeholder="https://… ou brand/logo-….png" />
          <div className="row">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Enviar logo" onChange={e => onLogoFile(e.target.files?.[0])} disabled={uploading} />
            {uploading && <span className="muted" role="status">Enviando…</span>}
            {brand.logoUrl && <button type="button" className="btn btn-sm" onClick={() => setBrand('logoUrl', '')}>Remover logo</button>}
          </div>
        </div>
      </Row>
      <Row title="Redes e site" desc="Links opcionais (só para referência futura; não aparecem na barra lateral no MVP).">
        <div className="row stack">
          <input className="input" value={brand.links?.website || ''} onChange={e => setLink('website', e.target.value)} placeholder="Site (https://…)" />
          <input className="input" value={brand.links?.linkedin || ''} onChange={e => setLink('linkedin', e.target.value)} placeholder="LinkedIn (https://…)" />
          <input className="input" value={brand.links?.twitter || ''} onChange={e => setLink('twitter', e.target.value)} placeholder="X / Twitter (https://…)" />
        </div>
      </Row>
    </Card>
  </>;
}

export default function AppearanceSection({ s, set, theme, toggleTheme }) {
  const { S, toast } = useApp();
  const tr = useT();
  const enterprise = isEnterpriseMode(S.settings);
  return (
    <>
      <Card title="Experiência">
        <UiModeToggle />
      </Card>
      {enterprise && <BrandMarca s={s} set={set} toast={toast} />}
      <Card>
        <Row title={tr('settings.appearance.locale')} desc={tr('settings.appearance.localeDesc')}>
          <Select label={tr('settings.appearance.locale')} value={s.ui?.locale || 'pt-BR'} onChange={v => set('ui.locale', v)} options={[
            { value: 'pt-BR', label: tr('settings.appearance.localePt') },
            { value: 'en', label: tr('settings.appearance.localeEn') }
          ]} />
        </Row>
        <Row title={tr('settings.appearance.theme')} desc={tr('settings.appearance.themeDesc', { theme: theme === 'dark' ? tr('settings.appearance.themeCurrentDark') : tr('settings.appearance.themeCurrentLight') })}><button className="btn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />{tr('settings.appearance.useTheme', { theme: theme === 'dark' ? tr('settings.appearance.themeCurrentLight') : tr('settings.appearance.themeCurrentDark') })}</button></Row>
      </Card>
      <Card title={tr('settings.appearance.shortcuts')}>
        <dl className="keys">
          <dt><kbd>Ctrl</kbd><kbd>K</kbd></dt><dd>Buscar conversas, agentes e ações</dd>
          <dt><kbd>Ctrl</kbd><kbd>,</kbd></dt><dd>Abrir configurações</dd>
          <dt><kbd>Ctrl</kbd><kbd>B</kbd></dt><dd>Recolher a barra lateral</dd>
          <dt><kbd>Ctrl</kbd><kbd>.</kbd></dt><dd>Recolher o painel da conversa</dd>
          <dt><kbd>Enter</kbd></dt><dd>Enviar mensagem</dd>
          <dt><kbd>Shift</kbd><kbd>Enter</kbd></dt><dd>Nova linha</dd>
          <dt><kbd>Esc</kbd></dt><dd>Parar a resposta</dd>
          <dt>Botão direito</dt><dd>Ações da conversa (renomear, exportar, apagar)</dd>
        </dl>
      </Card>
    </>
  );
}
