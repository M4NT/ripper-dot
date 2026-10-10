import { StrictMode, Component, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { restoreWidths } from './resize.jsx';
import { lazyReload } from './lazyReload.js';
restoreWidths();

// Baixa App e Login em paralelo com o /api/auth/status (não espera o JSON para começar o chunk).
const appReady = import('./app.jsx');
const loginReady = import('./login.jsx');
const App = lazyReload(() => appReady);
const Login = lazyReload(() => loginReady);
const bootScreen = <div className="boot"><p className="muted">Conectando…</p></div>;

// Última linha de defesa: um erro de tela nunca vira página em branco.
class Guard extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  // Trocar de tela (voltar, atalho, link) sai do erro em vez de prender o app inteiro nele.
  reset = () => this.state.error && this.setState({ error: null });
  componentDidMount() { addEventListener('hashchange', this.reset); }
  componentWillUnmount() { removeEventListener('hashchange', this.reset); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot">
        {/dynamically imported module|Failed to fetch dynamically|Importing a module script failed/i.test(String(this.state.error?.message))
          ? <><p>Há uma versão nova do Ripper.</p><p className="muted">Recarregue para continuar de onde parou.</p><button className="btn btn-primary" onClick={() => location.reload()}>Recarregar</button></>
          : <><p>Algo quebrou nesta tela.</p><p className="muted">{String(this.state.error.message || this.state.error)}</p><button className="btn" onClick={() => { this.setState({ error: null }); location.hash = '#/'; }}>Voltar ao início</button></>}
      </div>
    );
  }
}

// Senha única: sem sessão, mostra a tela de entrar (ou de criar a senha) em vez do app.
let build; // id da build quando a aba abriu
const root = createRoot(document.getElementById('root'));
const boot = () => fetch('/api/auth/status').then(r => r.json()).catch(() => ({ authed: true })).then(s => {
  build ??= s.build;
  root.render(<StrictMode><Guard><Suspense fallback={bootScreen}>{s.authed ? <App /> : <Login status={s} onDone={boot} />}</Suspense></Guard></StrictMode>);
});
boot();

// Nova build no servidor (npm run build) com a aba aberta: avisa em vez de quebrar ao abrir uma tela sob demanda.
setInterval(() => fetch('/api/auth/status').then(r => r.json()).then(s => {
  if (!s.build) return;
  if (build && s.build !== build && !document.getElementById('new-version')) {
    const b = Object.assign(document.createElement('button'), { id: 'new-version', className: 'btn btn-primary', textContent: 'Nova versão — recarregar', onclick: () => location.reload() });
    Object.assign(b.style, { position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: 9999 });
    document.body.append(b);
  }
}).catch(() => {}), 60e3);
