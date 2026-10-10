import { lazy, Suspense } from 'react';
import { useApp } from '../app.jsx';
import { Icon } from '../ui.jsx';
import SettingsSearch from '../settingsSearch.jsx';
import { useSettingsDraft } from '../settingsForm.js';
import { isEnterpriseMode, isSettingsTabAllowed } from '../uiMode.js';
import { EnterpriseHint } from '../uiModeToggle.jsx';
import { useT, settingsTabs } from '../i18n/index.jsx';
import { SaveBar } from '../settings/shared.jsx';
import '../styles/telas/pages/Settings.css';

export { SaveBar } from '../settings/shared.jsx';

const ProfileSection = lazy(() => import('../settings/ProfileSection.jsx'));
const ModelsSection = lazy(() => import('../settings/ModelsSection.jsx'));
const ComputerSection = lazy(() => import('../settings/ComputerSection.jsx'));
const ChannelsSection = lazy(() => import('../settings/ChannelsSection.jsx'));
const PluginsSection = lazy(() => import('../settings/PluginsSection.jsx'));
const SecuritySection = lazy(() => import('../settings/SecuritySection.jsx'));
const BackupSection = lazy(() => import('../settings/BackupSection.jsx'));
const MemorySection = lazy(() => import('../settings/MemorySection.jsx'));
const AppearanceSection = lazy(() => import('../settings/AppearanceSection.jsx'));
const AdvancedSection = lazy(() => import('../settings/AdvancedSection.jsx'));

const SECTIONS = {
  profile: ProfileSection,
  models: ModelsSection,
  computer: ComputerSection,
  channels: ChannelsSection,
  plugins: PluginsSection,
  security: SecuritySection,
  backup: BackupSection,
  memory: MemorySection,
  appearance: AppearanceSection,
  advanced: AdvancedSection
};

export default function Settings({ theme, toggleTheme, tab: initial }) {
  const { S } = useApp();
  const tr = useT();
  const SETTINGS_TABS = settingsTabs(tr);
  const d = useSettingsDraft();
  const { s, set } = d;
  const enterprise = isEnterpriseMode(S.settings);
  const allowedTabs = SETTINGS_TABS.filter(([k]) => isSettingsTabAllowed(k, S.settings));
  const tab = allowedTabs.some(([k]) => k === initial) ? initial : 'profile';
  const current = allowedTabs.find(([k]) => k === tab) || allowedTabs[0];
  const Section = SECTIONS[tab] || ProfileSection;

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label={tr('settings.navLabel')}>
        <h1>{tr('settings.title')}</h1>
        <SettingsSearch allowed={new Set(allowedTabs.map(([k]) => k))} />
        {allowedTabs.map(([k, l, ic, hint]) => (
          <a key={k} href={`#/settings/${k}`} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}>
            <Icon name={ic} size={17} /><span><b>{l}</b><small>{hint}</small></span>
          </a>
        ))}
        {!enterprise && (
          <p className="settings-simple-hint muted small"><EnterpriseHint>Computador, conectores e opções técnicas ficam no modo Enterprise.</EnterpriseHint></p>
        )}
      </nav>

      <div className="settings-main">
        <header className="settings-head"><h2>{current[1]}</h2><p>{current[3]}</p></header>
        <Suspense fallback={<p className="muted" role="status">Carregando…</p>}>
          <Section s={s} set={set} theme={theme} toggleTheme={toggleTheme} />
        </Suspense>
        <SaveBar {...d} />
      </div>
    </div>
  );
}
