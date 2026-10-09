import { useEffect, useState } from 'react';
import { local } from '../lib.js';
import { useApp } from '../app.jsx';
import { fmtAgo, go, useRoute } from '../lib.js';
import { Icon, Menu, MenuItem } from '../ui.jsx';
import HubShell from '../marketplace/HubShell.jsx';
import { PARTNER_SKILLS } from '../marketplace/catalog.js';
import { useSkillEditor } from '../skills.jsx';
import '../styles/telas/pages/SkillsHub.css';

function Mine({ S }) {
  const edit = useSkillEditor();
  const partner = PARTNER_SKILLS;
  const userSkills = S.skills;

  return (
    <>
      <section className="mp-section">
        <div className="mp-section-head"><h2>Da Anthropic e parceiros <span className="tag">{partner.length}</span></h2></div>
        <ul className="mp-skill-list">
          {partner.map(s => (
            <li key={s.id} className="mp-skill-row">
              <span className="mp-skill-ico"><Icon name="file" size={18} /></span>
              <span className="mp-skill-text">
                <b>{s.name}</b> <span className="tag">{s.provider}</span>
                <small>{s.desc}</small>
              </span>
              <time className="muted">anteontem</time>
            </li>
          ))}
        </ul>
      </section>
      <section className="mp-section">
        <div className="mp-section-head"><h2>Suas skills <span className="tag">{userSkills.length}</span></h2></div>
        {userSkills.length === 0 ? (
          <p className="muted">Nenhuma skill sua ainda. Crie uma ou use a Biblioteca.</p>
        ) : (
          <ul className="mp-skill-list">
            {userSkills.map(k => (
              <li key={k.id}>
                <button type="button" className="mp-skill-row" onClick={() => edit(k)}>
                  <span className="mp-skill-ico"><Icon name="bolt" size={18} /></span>
                  <span className="mp-skill-text"><b>{k.name}</b><small>{k.description || 'Sem descrição'}</small></span>
                  <time className="muted">{fmtAgo(k.updatedAt)}</time>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Discover() {
  return (
    <section className="mp-section">
      <p className="lede">Explore skills de parceiros no Marketplace ou instale plugins que tragam habilidades prontas.</p>
      <button type="button" className="btn" onClick={() => go('/marketplace')}><Icon name="store" size={16} /> Abrir Marketplace</button>
    </section>
  );
}

export default function SkillsHub() {
  const { S } = useApp();
  const { parts } = useRoute();
  const tab = parts[1] === 'discover' ? 'discover' : 'mine';
  const [q, setQ] = useState('');
  const edit = useSkillEditor();
  useEffect(() => {
    if (local.get('skills.openCreate', false)) {
      local.set('skills.openCreate', false);
      edit(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <HubShell
      title="Habilidades"
      tabs={[['mine', 'Meus'], ['discover', 'Descobrir']]}
      tab={tab}
      onTab={k => go(k === 'discover' ? '/skills/discover' : '/skills')}
      search={q}
      onSearch={setQ}
      searchPlaceholder="Pesquisar habilidades e plugins"
      actions={
        <div className="mp-skill-actions">
          <button type="button" className="icon-btn sm" aria-label="Filtrar"><Icon name="filter" size={16} /></button>
          <button type="button" className="icon-btn sm" aria-label="Ordenar"><Icon name="sort" size={16} /></button>
          <Menu align="right" trigger={({ toggle }) => (
            <button type="button" className="btn btn-primary btn-sm" onClick={toggle}><Icon name="plus" size={14} /> Adicionar <Icon name="down" size={14} /></button>
          )}>
            <MenuItem icon="upload" onClick={() => go('/library')}>Fazer upload de habilidade</MenuItem>
            <MenuItem icon="edit" onClick={() => edit(null)}>Criar uma habilidade</MenuItem>
            <MenuItem icon="chat" onClick={() => go('/')}>Criar com o Claude</MenuItem>
            <MenuItem icon="video" onClick={() => go('/library')}>Gravar sua tela</MenuItem>
          </Menu>
        </div>
      }
    >
      {tab === 'discover' ? <Discover /> : <Mine S={S} />}
    </HubShell>
  );
}
