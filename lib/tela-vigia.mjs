// Vigia de tela: tira uma foto da VM a cada poucos segundos e, quando a área de interesse muda,
// chama o webhook da rotina marcada com vigiaTela (como se fosse um aviso em tempo real).
// recorte: área da tela que conta (ex.: só a lista de conversas), para relógio ou barra de tarefas não disparar.
// Entre dois avisos da mesma rotina espera cooldownMs; mudança nesse intervalo fica pendente e dispara depois.
// ponytail: compara só a área recortada, sem reconhecer texto. Se o chat rolar sozinho ou houver animação dentro da área, ainda dispara.
import { createHash, createHmac } from 'node:crypto';

/** Assinatura igual à que o Ripper confere em /api/hooks/<token>. */
export const assinar = (secret, raw) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

/**
 * `alvos()` devolve [{ routine, computer }] das rotinas que vigiam a tela.
 * `porta` é a porta local do Ripper. Só faz POST quando a área recortada muda de verdade.
 */
export function startTelaVigia({ alvos, porta, intervaloMs = 10_000, cooldownMs = 30_000, fetchFn = fetch, log = () => {}, agora = Date.now }) {
  const ultimo = new Map();   // hash da última foto por rotina
  const aviso = new Map();    // quando foi o último POST
  const pendente = new Set(); // mudou durante o cooldown
  let rodando = false;

  const disparar = async routine => {
    const raw = JSON.stringify({ evento: 'tela_mudou', quando: new Date(agora()).toISOString() });
    const r = await fetchFn(`http://127.0.0.1:${porta}/api/hooks/${routine.hookToken}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': assinar(routine.hookSecret, raw) }, body: raw
    });
    // 429: a rotina ainda está ocupada (execução anterior ou reserva depois de reinício). Mantém a mudança pendente e tenta de novo.
    if (r.status === 429) return;
    aviso.set(routine.id, agora());
    pendente.delete(routine.id);
    log(`vigia: tela mudou -> ${routine.name} (${r.status})`);
  };

  const timer = setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      for (const { routine, computer } of alvos()) {
        if (!computer?.screenshot) continue;
        const foto = await computer.screenshot({ recorte: routine.recorte });
        const h = createHash('sha256').update(foto).digest('hex');
        const antes = ultimo.get(routine.id);
        ultimo.set(routine.id, h);
        if (antes && antes !== h) pendente.add(routine.id);
        if (!pendente.has(routine.id)) continue;
        const ultimoAviso = aviso.get(routine.id);
        if (ultimoAviso && agora() - ultimoAviso < cooldownMs) continue; // cooldown só vale entre dois avisos
        await disparar(routine);
      }
    } catch (e) {
      log('vigia: ' + (e.message || e));
    } finally { rodando = false; }
  }, intervaloMs);
  timer.unref();
  return timer;
}
