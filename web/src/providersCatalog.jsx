// Provedores de IA: todos os que dá para conectar, com logo, status e o que cada um faz no Ripper.
import { Icon } from './ui.jsx';
import claudeSvg from './assets/providers/claude-color.svg?raw';
import openaiSvg from './assets/providers/openai.svg?raw';
import openrouterSvg from './assets/providers/openrouter.svg?raw';
import geminiSvg from './assets/providers/gemini-color.svg?raw';
import cursorSvg from './assets/providers/cursor.svg?raw';
import ollamaSvg from './assets/providers/ollama.svg?raw';
import antigravitySvg from './assets/providers/antigravity-color.svg?raw';

// SVGs vendorizados (lobehub, MIT): mono usam currentColor e acompanham o tema.
const svg = raw => raw.replace(/ (width|height)="1em"/g, '');

export const PROVIDERS = [
  {
    id: 'julia', name: 'Julia 1', kind: 'Roteador local', provider: null,
    tagline: 'Decide, antes do modelo grande, qual IA e quanto esforço cada pedido merece.',
    can: ['Escolhe o modelo no Ripper Auto', 'Escolhe o esforço', 'Decide quem fala primeiro no grupo', 'Cache de respostas parecidas', 'Roda nesta máquina, sem custo'],
    cannot: ['Não responde sozinha: só faz a triagem']
  },
  {
    id: 'claude', name: 'Claude', kind: 'Anthropic', logo: claudeSvg, provider: 'claude',
    tagline: 'O motor principal dos agentes: conversa, raciocínio, computador e navegador.',
    can: ['Todas as ferramentas do Ripper', 'Computador e navegador do agente', 'Pesquisa na web', 'Lê imagens', 'Conectores do claude.ai (Gmail, Drive, Agenda…)', 'Plugins MCP', 'Esforço de raciocínio ajustável', 'Processo pré-aquecido (responde mais rápido)'],
    cannot: []
  },
  {
    id: 'codex', name: 'ChatGPT', kind: 'OpenAI · Codex', logo: openaiSvg, provider: 'codex',
    tagline: 'Codex com o login do ChatGPT: forte em escrever e rodar código.',
    can: ['Escrever, rodar e depurar código', 'Ferramentas do Ripper (memória, artefatos, mensagens)', 'Plugins MCP', 'Lê imagens'],
    cannot: ['Pesquisa web do Claude', 'Conectores do claude.ai']
  },
  {
    id: 'openrouter', name: 'OpenRouter', kind: 'Centenas de modelos', logo: openrouterSvg, provider: 'openrouter',
    tagline: 'Uma chave só para GPT, Gemini, DeepSeek, Llama, Grok, Mistral e outros.',
    can: ['Ferramentas do Ripper', 'Computador e navegador do agente', 'Pesquisa na web (do OpenRouter)', 'Lê imagens (modelos com visão)', 'Pago por uso, sem assinatura'],
    cannot: ['Plugins MCP (em breve)', 'Escolha automática pelo Ripper Auto']
  },
  { id: 'openai', name: 'OpenAI API', kind: 'Chave da API', logo: openaiSvg, soon: true, tagline: 'GPT direto pela chave da OpenAI, sem passar pelo OpenRouter.', can: ['Ferramentas do Ripper', 'Lê imagens'], cannot: [] },
  { id: 'gemini', name: 'Gemini', kind: 'Google AI Studio', logo: geminiSvg, soon: true, tagline: 'Modelos Gemini pela chave do AI Studio. Hoje: pelo OpenRouter.', can: ['Ferramentas do Ripper', 'Contexto muito longo', 'Lê imagens e vídeo'], cannot: [] },
  { id: 'antigravity', name: 'Antigravity', kind: 'Google', logo: antigravitySvg, soon: true, tagline: 'É um editor, sem API pública. Os mesmos modelos chegam pelo Gemini.', can: ['Modelos Gemini (via Gemini ou OpenRouter)'], cannot: ['Conexão direta: não existe API'] },
  { id: 'cursor', name: 'Cursor', kind: 'cursor-agent', logo: cursorSvg, soon: true, tagline: 'Agente de código do Cursor pela linha de comando, como o Codex.', can: ['Escrever e rodar código'], cannot: [] },
  { id: 'ollama', name: 'Ollama', kind: 'Modelos locais', logo: ollamaSvg, soon: true, tagline: 'Llama, Qwen, DeepSeek e outros rodando nesta máquina, de graça e offline.', can: ['Sem custo por uso', 'Nada sai da máquina'], cannot: [] }
];

export function ProviderLogo({ p, dark, size = 40 }) {
  if (p.id === 'julia') return <span className="prov-logo prov-julia" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">J1</span>;
  return <span className="prov-logo" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg(p.logo) }} />;
}

/** status: { [id]: { tone: 'ok' | 'warn' | 'off', label } } */
export function ProviderGrid({ status, counts, dark, onOpen }) {
  return (
    <ul className="prov-grid" aria-label="Provedores de IA">
      {PROVIDERS.map(p => {
        const st = p.soon ? { tone: 'off', label: 'em breve' } : status[p.id] || { tone: 'off', label: 'não conectado' };
        return (
          <li key={p.id}>
            <button type="button" className={`prov-card ${p.soon ? 'is-soon' : ''}`} onClick={() => onOpen(p.id)}>
              <span className="prov-card-head">
                <ProviderLogo p={p} dark={dark} />
                <span className={`tag ${st.tone === 'ok' ? 'tag-ok' : st.tone === 'warn' ? 'tag-warn' : ''}`}>{st.label}</span>
              </span>
              <b>{p.name}</b>
              <small className="prov-kind">{p.kind}{counts[p.provider] ? ` · ${counts[p.provider]} ${counts[p.provider] === 1 ? 'modelo' : 'modelos'}` : ''}</small>
              <span className="prov-tagline">{p.tagline}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Cabeçalho do detalhe: logo, o que faz e o que (ainda) não faz no Ripper. */
export function ProviderHeader({ p, status, dark, onBack }) {
  const st = p.soon ? { tone: 'off', label: 'em breve' } : status[p.id] || { tone: 'off', label: 'não conectado' };
  return (
    <section className="set-card prov-detail">
      <button type="button" className="btn btn-sm prov-back" onClick={onBack}><Icon name="left" size={14} />Todos os provedores</button>
      <header className="prov-detail-head">
        <ProviderLogo p={p} dark={dark} size={56} />
        <div><h3>{p.name}</h3><small className="prov-kind">{p.kind}</small></div>
        <span className={`tag ${st.tone === 'ok' ? 'tag-ok' : st.tone === 'warn' ? 'tag-warn' : ''}`}>{st.label}</span>
      </header>
      <p className="set-card-desc">{p.tagline}</p>
      <div className="prov-caps">
        <div><b>No Ripper ele faz</b><ul>{p.can.map(c => <li key={c}><Icon name="check" size={13} />{c}</li>)}</ul></div>
        {p.cannot.length > 0 && <div><b>Ainda não faz</b><ul className="is-not">{p.cannot.map(c => <li key={c}><Icon name="x" size={13} />{c}</li>)}</ul></div>}
      </div>
      {p.soon && <p className="muted small">Ainda não dá para conectar por aqui. Está no roadmap.</p>}
    </section>
  );
}
