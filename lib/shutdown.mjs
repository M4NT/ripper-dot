/**
 * Encerramento gracioso (SIGTERM/SIGINT): deixa de aceitar tráfego novo, drena HTTP e persiste estado.
 */

/** Código de saída "reinicie-me": o vigia (scripts/service.mjs run) sobe de novo na hora. */
export const RESTART_EXIT_CODE = 75;

/** Espera os turnos em andamento acabarem (até maxMs). Devolve quantos ficaram rodando (0 = todos terminaram). */
export async function waitForTurns(getActiveTurns, maxMs, pollMs = 250) {
  const deadline = Date.now() + maxMs;
  let n;
  while ((n = getActiveTurns?.() || 0) > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, pollMs));
  return n;
}

let beginShutdownImpl = null;
/** Encerramento pedido de dentro (ex.: atualização): mesmo caminho do SIGTERM, mas sai com outro código. */
export function requestShutdown(reason, exitCode = 0) {
  beginShutdownImpl?.(reason, exitCode);
}

export const SHUTDOWN_MESSAGE = 'Servidor em encerramento; tente novamente em instantes.';

let shuttingDown = false;
let handlersRegistered = false;

export function isShuttingDown() {
  return shuttingDown;
}

/** Só para testes unitários (não registra handlers). */
export function _markShuttingDownForTests(value = true) {
  shuttingDown = value;
}

/**
 * @param {import('node:http').Server} httpServer
 * @param {{ flush?: () => void, closeStores?: () => void, onBeginShutdown?: () => void, getActiveConnections?: () => number, getActiveTurns?: () => number, logger?: { info: Function, warn: Function, error: Function }, log?: (...args: unknown[]) => void }} [opts]
 */
export function registerGracefulShutdown(httpServer, opts = {}) {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const shutdownMs = Math.max(0, Number(process.env.RIPPER_SHUTDOWN_MS) || 10_000);
  // Turnos em andamento terminam antes de sair; o que passar do prazo é retomado depois (autoResumeAfterRestart).
  const turnsMs = Math.max(0, Number(process.env.RIPPER_DRAIN_TURNS_MS ?? 120_000));
  let exitCode = 0;
  const logInfo = (msg, extra) => {
    if (opts.logger) opts.logger.info(msg, extra);
    else if (opts.log) opts.log(`[shutdown] ${msg}`, extra);
    else console.log(`[shutdown] ${msg}`, extra ?? '');
  };
  const logWarn = (msg, extra) => {
    if (opts.logger) opts.logger.warn(msg, extra);
    else if (opts.log) opts.log(`[shutdown] ${msg}`, extra);
    else console.warn(`[shutdown] ${msg}`, extra ?? '');
  };
  const logError = (msg, extra) => {
    if (opts.logger) opts.logger.error(msg, extra);
    else console.error(`[shutdown] ${msg}`, extra ?? '');
  };
  let finishing = false;
  let forceTimer;
  let idleTimer;
  let closing = false;

  const activeConnections = () => {
    const n = opts.getActiveConnections?.();
    return typeof n === 'number' && n >= 0 ? n : 0;
  };

  const finish = (code = 0) => {
    if (finishing) return;
    finishing = true;
    if (forceTimer) clearTimeout(forceTimer);
    if (idleTimer) clearInterval(idleTimer);
    logInfo('shutdown.complete');
    process.exit(code);
  };

  const persistAndCloseStores = () => {
    try {
      opts.flush?.();
    } catch (e) {
      logError('shutdown.flush_failed', { error: e?.message || String(e) });
    }
    try {
      opts.closeStores?.();
    } catch (e) {
      logError('shutdown.close_stores_failed', { error: e?.message || String(e) });
    }
  };

  const beginHttpClose = (forced = false) => {
    if (closing) return;
    closing = true;
    if (forced) {
      logWarn('shutdown.timeout', { shutdownMs });
      try {
        httpServer.closeAllConnections?.();
      } catch {}
    }
    httpServer.close(err => {
      if (err) logError('shutdown.server_close_failed', { error: err?.message || String(err) });
      persistAndCloseStores();
      finish(forced && !exitCode ? 1 : exitCode);
    });
  };

  const scheduleDrain = () => {
    idleTimer = setInterval(() => {
      if (activeConnections() === 0) beginHttpClose(false);
    }, 100);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();

    forceTimer = setTimeout(() => beginHttpClose(true), shutdownMs);
    if (typeof forceTimer.unref === 'function') forceTimer.unref();
  };

  const begin = async (signal, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = code;
    logInfo('shutdown.start', { signal, shutdownMs, turnsMs });

    try {
      opts.onBeginShutdown?.();
    } catch (e) {
      logError('shutdown.on_begin_failed', { error: e?.message || String(e) });
    }

    const left = await waitForTurns(opts.getActiveTurns, turnsMs);
    if (left) logWarn('shutdown.turns_timeout', { left });
    persistAndCloseStores();
    scheduleDrain();
  };
  beginShutdownImpl = begin;

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => begin(sig));
  }
}
