import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { UiExamples } from './examples.jsx';

/** Entrada só de desenvolvimento: web/ui-primitives.html */
function Preview() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  useEffect(() => {
    if (theme === 'light') document.documentElement.dataset.theme = 'light';
    else document.documentElement.removeAttribute('data-theme');
  }, [theme]);

  return (
    <div className="ui-ex-preview">
      <div className="ui-ex-toolbar" style={{ padding: '16px 16px 0' }}>
        <button type="button" className="btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
          Tema {theme === 'dark' ? 'escuro' : 'claro'}
        </button>
      </div>
      <UiExamples />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Preview /></StrictMode>);
