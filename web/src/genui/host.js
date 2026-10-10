// Ponte mínima com o chat: o cartão manda o texto e o Chat.jsx envia como mensagem.
let host = { chatId: null, send: null };

export function setGenUiHost(next) {
  host = { ...host, ...next };
}

export function getGenUiHost() {
  return host;
}

export function chatIdFromLocation() {
  const m = /#\/c\/([\w-]+)/.exec(typeof location !== 'undefined' ? location.hash : '');
  return m?.[1] || null;
}
