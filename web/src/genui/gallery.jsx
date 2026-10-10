import { createRoot } from 'react-dom/client';
import { GENUI_CATALOG, GENUI_NAMES } from '../../../lib/genui-catalog.mjs';
import { GenUiView } from './registry.jsx';
import '../styles.css';
import '../styles/telas/genui.css';

function App() {
  return (
    <div className="oui-gallery-page">
      <h1>UI generativa</h1>
      <p>Catálogo do Ripper no recorte da ObsidianUI (cartão, botão, selo, abas) e da casca do UI-2. Sem efeitos pesados.</p>
      {GENUI_NAMES.map(name => {
        const entry = GENUI_CATALOG[name];
        return (
          <section key={name} id={name}>
            <h2>{entry.title} <code>show_{name}</code></h2>
            <p className="oui-muted">{entry.when}</p>
            <GenUiView part={{ id: name, kind: 'ui', component: name, props: entry.example, state: 'input-available' }} onAction={() => {}} />
          </section>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
