import { Icon } from './ui.jsx';

function modelConnected(settings) {
  if (settings.claude?.mode === 'api') return !!(settings.claude.apiKey || '').trim();
  return settings.claude?.mode === 'subscription';
}

/** Checklist curta para quem abre o chat vazio pela primeira vez. */
export function FirstRunChecklist({ settings, agentCount }) {
  const steps = [
    {
      id: 'model',
      label: 'Conectar um modelo',
      detail: 'Claude por assinatura ou chave de API em Configurações.',
      done: modelConnected(settings),
      href: '#/settings/models'
    },
    {
      id: 'models',
      label: 'Escolher quais IAs usar',
      detail: 'Ligue só as que você quer e limite o esforço de cada uma. O Ripper Auto escolhe dentro disso.',
      done: Object.keys(settings.models?.enabled || {}).length + Object.keys(settings.models?.maxEffort || {}).length > 0,
      href: '#/settings/models'
    },
    {
      id: 'agent',
      label: 'Criar um agente',
      detail: 'Dê nome e função — ou use um template.',
      done: agentCount > 0,
      href: '#/new'
    },
    {
      id: 'message',
      label: 'Enviar uma mensagem',
      detail: 'Escreva abaixo e pressione Enter.',
      done: false
    }
  ];
  const pending = steps.filter(s => !s.done).length;
  if (pending === 0) return null;

  return (
    <div className="first-run-checklist" role="region" aria-label="Primeiros passos">
      <p className="first-run-lead">Para começar:</p>
      <ol className="first-run-steps">
        {steps.map(s => (
          <li key={s.id} className={s.done ? 'done' : ''}>
            <span className="first-run-mark" aria-hidden="true">{s.done ? <Icon name="check" size={14} /> : '○'}</span>
            <span className="first-run-text">
              {s.href && !s.done ? <a className="link" href={s.href}>{s.label}</a> : <b>{s.label}</b>}
              <small>{s.detail}</small>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
