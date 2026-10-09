import { useEffect, useState } from 'react';
import { api } from './lib.js';
import { useApp } from './app.jsx';
import { Skeleton } from './ui.jsx';

// Agenda das rotinas: próximos 7 dias por horário (na mesma lista para celular e computador).
// Intervalos e eventos têm seções próprias, porque não têm um horário fixo.
const ESTADO = { never: 'ainda não rodou', succeeded: 'deu certo', failed: 'falhou', running: 'rodando', quiet: 'sem aviso' };
const DIA = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' });
const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function AgendaRotinas() {
  const { S } = useApp();
  const [agenda, setAgenda] = useState(null);
  useEffect(() => {
    let vivo = true;
    api('/api/routines/agenda?dias=7')
      .then(a => { if (vivo) setAgenda(a); })
      .catch(() => { if (vivo) setAgenda({ itens: [], intervalos: [], eventos: [] }); });
    return () => { vivo = false; };
  }, [S.routines]);
  if (!agenda) return <Skeleton rows={3} label="Carregando agenda" />;

  const dias = new Map();
  for (const it of agenda.itens) {
    const chave = new Date(it.quando).toDateString();
    if (!dias.has(chave)) { const dia = DIA.format(new Date(it.quando)); dias.set(chave, { titulo: dia.charAt(0).toUpperCase() + dia.slice(1), itens: [] }); }
    dias.get(chave).itens.push(it);
  }
  const vazia = !agenda.itens.length && !agenda.intervalos.length && !agenda.eventos.length;

  return (
    <section className="agenda" aria-label="Próximos 7 dias">
      <h2 className="agenda-titulo">Próximos 7 dias</h2>
      {vazia && <p className="muted small">Nenhuma rotina dispara nos próximos 7 dias.</p>}
      {[...dias.values()].map(d => (
        <div key={d.titulo} className="agenda-dia">
          <h3>{d.titulo}</h3>
          <ul>
            {d.itens.map(it => (
              <li key={it.quando + it.rotinaId}>
                <time>{HORA.format(new Date(it.quando))}</time>
                <span className="agenda-nome">{it.nome}</span>
                <span className="agenda-agente">{it.agenteNome}</span>
                <span className={`agenda-estado ${it.ultimoStatus}`}>{ESTADO[it.ultimoStatus] || it.ultimoStatus}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {agenda.intervalos.length > 0 && (
        <div className="agenda-dia">
          <h3>Rodam a cada intervalo</h3>
          <ul>
            {agenda.intervalos.map(i => (
              <li key={i.rotinaId}>
                <span className="agenda-nome">{i.nome}</span>
                <span className="agenda-agente">{i.agenteNome}</span>
                <span className="agenda-estado">a cada {i.minutos} min</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {agenda.eventos.length > 0 && (
        <div className="agenda-dia">
          <h3>Disparam quando chega um evento</h3>
          <ul>
            {agenda.eventos.map(e => (
              <li key={e.rotinaId}>
                <span className="agenda-nome">{e.nome}</span>
                <span className="agenda-agente">{e.agenteNome}</span>
                <span className="agenda-estado">{e.gatilho}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
