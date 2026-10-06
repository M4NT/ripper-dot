import { useState } from 'react';
import HubShell from '../marketplace/HubShell.jsx';
import { Icon } from '../ui.jsx';

// Central de ajuda: o que cada coisa faz e pedidos prontos (um clique escreve na conversa).
const TOPICS = [
  { icon: 'agents', title: 'Agentes', text: 'Cada agente é um assistente com função, memória e computador próprio. Fale com ele como falaria com uma pessoa da equipe.',
    examples: ['Crie um agente de atendimento para responder dúvidas de clientes', 'O que você consegue fazer por mim?'] },
  { icon: 'chat', title: 'Conversa', text: 'Um agente tem uma conversa só com você. Arraste outro agente para a conversa (ou escreva @Nome) para chamá-lo junto.',
    examples: ['Resuma o que conversamos até agora', 'Peça ajuda ao colega certo para isso'] },
  { icon: 'inbox', title: 'Caixa', text: 'Tudo que espera você: aprovações (enviar, publicar, rodar algo), perguntas dos agentes, recados de clientes e avisos. Atalhos: J/K navegam, A aprova, R recusa.',
    examples: [] },
  { icon: 'clock', title: 'Rotinas', text: 'Tarefas que o agente faz sozinho num horário ou quando algo acontece. Ele só deixa conversa quando tem novidade.',
    examples: ['Todo dia às 8h, me mande um resumo dos meus e-mails importantes', 'Toda sexta, faça um relatório da semana'] },
  { icon: 'plug', title: 'Conectar aplicativos', text: 'Gmail, Agenda, Drive, GitHub e outros: o botão "Conectar aplicativos", no pé da barra lateral, mostra o que dá para ligar.',
    examples: ['Quais aplicativos você consegue usar agora?'] },
  { icon: 'terminal', title: 'Computador do agente', text: 'Cada agente tem um computador isolado: navega, roda programas e cria arquivos sem mexer no seu. Veja a tela dele na aba Computador da ficha.',
    examples: ['Abra o site da empresa e me diga o que pode melhorar'] },
  { icon: 'gear', title: 'Configurações sem procurar', text: 'Peça na conversa ("quero o resumo diário", "esconda CPF da IA") e o agente mostra o interruptor ali mesmo. Nada muda sem o seu clique.',
    examples: ['Quero receber um resumo diário', 'Esconda CPF e documentos antes de mandar para a IA'] },
  { icon: 'key', title: 'Segurança', text: 'O Ripper roda no seu computador. Ações com efeito fora (enviar mensagem, publicar, gastar) pedem a sua aprovação. Senha protege o acesso.',
    examples: [] }
];

export default function Help() {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const shown = TOPICS.filter(x => !t || `${x.title} ${x.text} ${x.examples.join(' ')}`.toLowerCase().includes(t));
  const use = text => { dispatchEvent(new Event('ripper:close-hub')); setTimeout(() => dispatchEvent(new CustomEvent('ripper:compose', { detail: { text } })), 150); };
  return (
    <HubShell title="Ajuda" search={q} onSearch={setQ} searchPlaceholder="O que você quer fazer?">
      <div className="help-grid">
        {shown.map(x => (
          <section key={x.title} className="help-card">
            <h2><Icon name={x.icon} size={17} />{x.title}</h2>
            <p>{x.text}</p>
            {x.examples.length > 0 && <div className="help-examples">{x.examples.map(e => (
              <button key={e} type="button" className="help-example" onClick={() => use(e)} title="Escrever na conversa"><Icon name="arrowR" size={13} />{e}</button>
            ))}</div>}
          </section>
        ))}
        {shown.length === 0 && <p className="muted">Nada encontrado. Pergunte direto a um agente: ele explica.</p>}
      </div>
    </HubShell>
  );
}
