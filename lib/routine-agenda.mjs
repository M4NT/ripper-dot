// Agenda das rotinas: o que vai disparar nos próximos dias, pela mesma regra de routineDue (lib/agent-flow.mjs).
// Rotinas diárias viram uma marca por horário; rotinas de intervalo viram um resumo ("a cada 15 min");
// rotinas com gatilho (webhook, e-mail, WhatsApp) não têm horário e ficam numa seção à parte.

const SOMENTE_HORA = /^\d\d:\d\d$/;

/**
 * Próximas execuções das rotinas, no fuso e no relógio do servidor (o mesmo que o agendador usa).
 * Devolve { itens, intervalos, eventos }. Itens vêm em ordem de horário.
 */
export function proximasExecucoes(rotinas = [], agora = new Date(), { dias = 7, agentes = [] } = {}) {
  const inicio = new Date(agora);
  inicio.setHours(0, 0, 0, 0);
  const agenteDe = id => agentes.find(a => a.id === id)?.name || '';
  const itens = [], intervalos = [], eventos = [];
  for (const r of rotinas) {
    if (r.trigger) { eventos.push({ rotinaId: r.id, nome: r.name, agenteNome: agenteDe(r.agentId), gatilho: r.trigger }); continue; }
    if (r.everyMinutes) { intervalos.push({ rotinaId: r.id, nome: r.name, agenteNome: agenteDe(r.agentId), minutos: r.everyMinutes }); continue; }
    if (!SOMENTE_HORA.test(r.dailyAt || '')) continue;
    const [hora, minuto] = r.dailyAt.split(':').map(Number);
    for (let d = 0; d < dias; d++) {
      const dia = new Date(inicio);
      dia.setDate(inicio.getDate() + d);
      const diaDaSemana = dia.getDay();
      if (r.weekday != null && r.weekday !== diaDaSemana) continue;
      if (r.weekdays && !(diaDaSemana >= 1 && diaDaSemana <= 5)) continue;
      const quando = new Date(dia);
      quando.setHours(hora, minuto, 0, 0);
      if (quando.getTime() < agora.getTime()) continue;
      itens.push({ quando: quando.toISOString(), rotinaId: r.id, nome: r.name, agenteNome: agenteDe(r.agentId), ultimoStatus: r.lastStatus || 'never' });
    }
  }
  itens.sort((a, b) => a.quando.localeCompare(b.quando));
  return { itens, intervalos, eventos };
}
