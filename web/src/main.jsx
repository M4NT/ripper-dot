import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';
import Login from './login.jsx';
import './styles.css';
import { restoreWidths } from './resize.jsx';
restoreWidths();

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
const root = createRoot(document.getElementById('root'));
const boot = () => fetch('/api/auth/status').then(r => r.json()).catch(() => ({ authed: true })).then(s =>
  root.render(<StrictMode><Guard>{s.authed ? <App /> : <Login status={s} onDone={boot} />}</Guard></StrictMode>));
boot();
