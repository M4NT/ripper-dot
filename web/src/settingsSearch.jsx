import { useState } from 'react';
import { go } from './lib.js';
import { Icon } from './ui.jsx';

// Onde cada configuração mora: [aba, texto que aparece na tela, palavras que as pessoas digitam].
// O texto é usado para rolar até a opção e destacá-la depois de abrir a aba.
const INDEX = [
  ['profile', 'Seu nome', 'nome perfil'],
  ['profile', 'Instruções gerais', 'prompt instruções sobre mim'],
  ['profile', 'Voz padrão dos agentes', 'tom formalidade estilo jeito de falar'],
  ['profile', 'Resumo do dia', 'pulse resumo diário whatsapp horário'],
  ['profile', 'Notificações', 'push celular avisos notificação'],
  ['models', 'Conta do Claude', 'teams pro pessoal trocar conta login assinatura limite', 'claude'],
  ['models', 'Como conectar', 'claude api key assinatura chave anthropic', 'claude'],
  ['models', 'OpenRouter', 'gpt gemini deepseek llama modelos chave', 'openrouter'],
  ['models', 'Uso pago', 'créditos dinheiro gasto limite consentimento', 'openrouter'],
  ['models', 'Padrão para agentes novos', 'modelo padrão'],
  ['models', 'Modelos', 'ligar desligar esforço teto', 'claude'],
  ['models', 'Fila de entrada', 'agrupar mensagens'],
  ['models', 'Como a Julia trabalha', 'julia ripper auto roteador tentativas', 'julia'],
  ['computer', 'Onde os agentes executam', 'docker boat nuvem local computador vm'],
  ['computer', 'Imagem de referência', 'reconstruir imagem docker atualizar ripper-agent'],
  ['computer', 'Parar ocioso após', 'desligar inatividade'],
  ['channels', 'Canal WhatsApp', 'whatsapp qr api oficial meta contatos'],
  ['channels', 'E-mail', 'email gmail senha de app imap smtp'],
  ['channels', 'GitHub — Guardião', 'github token repositórios guardião pr'],
  ['plugins', 'Servidores MCP', 'mcp conectores plugins'],
  ['security', 'Sandbox Docker', 'sandbox isolamento'],
  ['security', 'LGPD — dados pessoais', 'lgpd privacidade mascarar eliminar dados'],
  ['security', 'Limite de taxa', 'rate limit taxa'],
  ['security', 'Retenção de dados', 'apagar automaticamente retenção conversas antigas'],
  ['backup', 'Backup automático', 'backup cópia snapshot restaurar'],
  ['backup', 'Cópia extra em outra pasta', 'onedrive google drive dropbox disco externo'],
  ['memory', 'Memória', 'lembrar memórias'],
  ['memory', 'Poda dinâmica de contexto', 'contexto tokens histórico'],
  ['appearance', 'Experiência', 'tema claro escuro simples enterprise idioma'],
  ['advanced', 'Flags personalizadas', 'flags experimental']
];

const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Abre a aba e rola até a opção, com um destaque rápido. */
function reveal(tab, label, prov) {
  go(`/settings/${tab}${prov ? `?prov=${prov}` : ''}`);
  const want = fold(label);
  let tries = 0;
  const find = () => {
    const el = [...document.querySelectorAll('.settings-main .set-label b, .settings-main .set-card h3')].find(e => fold(e.textContent).startsWith(want));
    if (el) {
      const box = el.closest('.set-row, .set-card') || el;
      box.scrollIntoView({ block: 'center' });
      // a troca de aba devolve a página ao topo logo depois: rola de novo quando ela assentar
      setTimeout(() => box.isConnected && box.scrollIntoView({ block: 'center' }), 350);
      box.classList.add('set-flash');
      setTimeout(() => box.classList.remove('set-flash'), 1600);
    } else if (tries++ < 10) setTimeout(find, 120); // a aba pode demorar um instante para desenhar
  };
  setTimeout(find, 60);
}

/** Busca no topo das Configurações: "teams", "backup", "senha de app"… leva direto à opção. */
export default function SettingsSearch({ allowed }) {
  const [q, setQ] = useState('');
  const words = fold(q).split(/\s+/).filter(Boolean);
  const hits = words.length ? INDEX.filter(([tab, label, kw]) => allowed.has(tab) && words.every(w => fold(`${label} ${kw}`).includes(w))).slice(0, 7) : [];
  const pick = ([tab, label, , prov]) => { setQ(''); reveal(tab, label, prov); };
  return (
    <div className="settings-search">
      <label className="settings-search-box">
        <Icon name="search" size={15} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar configuração" aria-label="Buscar configuração"
          onKeyDown={e => { if (e.key === 'Enter' && hits[0]) pick(hits[0]); if (e.key === 'Escape') setQ(''); }} />
      </label>
      {words.length > 0 && (
        <ul className="settings-search-hits" role="listbox" aria-label="Resultados">
          {hits.map(h => (
            <li key={h[0] + h[1]}><button type="button" role="option" aria-selected="false" onClick={() => pick(h)}><b>{h[1]}</b></button></li>
          ))}
          {!hits.length && <li className="muted small">Nada encontrado.</li>}
        </ul>
      )}
    </div>
  );
}
