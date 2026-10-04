import { Icon } from './ui.jsx';
import { isEnterpriseMode } from './uiMode.js';

function modelConnected(settings) {
  if (settings.claude?.mode === 'api') return !!(settings.claude.apiKey || '').trim();
  return settings.claude?.mode === 'subscription';
}

/** Checklist curta para quem abre o chat vazio pela primeira vez. */
export function FirstRunChecklist({ settings, agentCount }) {
  const enterprise = isEnterpriseMode(settings);
  const steps = [
    {
      id: 'model',
      label: 'Conectar um modelo',
      detail: enterprise
        ? 'Claude por assinatura ou chave de API em Configurações.'
        : 'Use claude login nesta máquina ou ative o modo Enterprise em Configurações → Aparência para chave de API.',
      done: modelConnected(settings),
      href: enterprise ? '#/settings/models' : '#/settings/appearance'
    },
    {
      id: 'models',
      label: 'Escolher quais IAs usar',
      detail: enterprise
        ? 'Ligue só as que você quer e limite o esforço de cada uma. O Ripper Auto escolhe dentro disso.'
        : 'Escolha modelos e limites de esforço no modo Enterprise (Configurações → Aparência).',
      done: Object.keys(settings.models?.enabled || {}).length + Object.keys(settings.models?.maxEffort || {}).length > 0,
      href: enterprise ? '#/settings/models' : null
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
  // Com modelo conectado e agente criado, o checklist é ruído numa conversa que já funciona.
  if (steps[0].done && agentCount > 0) return null;
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
