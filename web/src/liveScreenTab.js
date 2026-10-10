import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  consumeLiveTabOpen, liveScreenAutoKey, liveScreenCanControl, screenControlIsMine,
  screenControlReleaseForOwner, shouldConnectThisTurn, shouldReleaseControlOnCloseFull
} from './liveScreenLogic.js';

/** O que a aba faz neste instante: abrir, ficar onde está, ligar a VM. */
export function liveComputerTabState({
  mode = 'docker', messages, working, busy, agentIds, tab = 'details', openedKey = '',
} = {}) {
  const liveKey = mode === 'docker' ? liveScreenAutoKey({ messages, working, busy, agentIds }) : '';
  const next = consumeLiveTabOpen(openedKey, liveKey);
  return {
    tab: next.open ? 'computer' : tab,
    openedKey: next.openedKey,
    open: next.open,
    liveKey,
    connect: (agentIds || []).some(id => shouldConnectThisTurn({ messages, working, busy, agentId: id })),
  };
}

/** Aba Computador: abre na 1ª vez do turno; working que chega depois não muda a chave. */
export function useLiveComputerTab({ mode, messages, working, busy, agentIds, chatId }) {
  const [tab, setTab] = useState('details');
  const openedLive = useRef('');
  const ids = agentIds || [];
  const memberKey = ids.join(',');
  const liveKey = useMemo(
    () => liveScreenAutoKey({ messages, working, busy, agentIds: memberKey ? memberKey.split(',') : [] }),
    [messages, working, busy, memberKey]
  );
  useEffect(() => { openedLive.current = ''; }, [chatId]);
  useEffect(() => {
    if (mode !== 'docker') return;
    const next = consumeLiveTabOpen(openedLive.current, liveKey);
    openedLive.current = next.openedKey;
    if (next.open) setTab('computer');
  }, [liveKey, mode]);
  const connect = ids.some(id => shouldConnectThisTurn({ messages, working, busy, agentId: id }));
  return { tab, setTab, liveKey, connect };
}

/**
 * Superfície da aba (sem JSX) — o teste renderiza este componente
 * para histórico + texto e para working que não pode reabrir.
 */
export function LiveComputerTab(props) {
  const s = liveComputerTabState(props);
  return createElement('section', {
    'data-live-tab': s.tab,
    'data-live-connect': s.connect ? '1' : '0',
    'data-live-key': s.openedKey,
    'data-live-open': s.open ? '1' : '0',
    'aria-label': 'Painel da tela ao vivo',
  }, s.connect ? 'Computador ao vivo' : (s.tab === 'computer' ? 'Computador' : 'Detalhes'));
}

/** Trava Assumir controle no painel e na miniatura (donos independentes). */
export function liveScreenControlState({
  variant = 'panel', control = false, big = false, owner = '', lockOwner = '',
} = {}) {
  const mine = screenControlIsMine({ control: true, owner: lockOwner }, owner);
  const holding = !!(control && mine);
  return {
    variant,
    canControl: liveScreenCanControl({ variant, control: holding, big }),
    releaseOnCloseFull: shouldReleaseControlOnCloseFull(variant),
    closeReleasesLock: screenControlReleaseForOwner(lockOwner, owner),
  };
}

export function LiveScreenControl(props) {
  const s = liveScreenControlState(props);
  return createElement('div', {
    'data-live-screen': s.variant,
    'data-can-control': s.canControl ? '1' : '0',
    'data-release-on-close-full': s.releaseOnCloseFull ? '1' : '0',
    'data-close-releases': s.closeReleasesLock ? '1' : '0',
    'aria-label': s.variant === 'float' ? 'Miniatura da tela ao vivo' : 'Painel da tela ao vivo',
  });
}
