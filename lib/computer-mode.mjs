// Qual computador os agentes têm de fato agora. 'none' = modo sem computador (conversa, pesquisa e memória seguem).
export function effectiveComputer(c = {}, dockerVersion = null, env = process.env) {
  if (c.mode === 'docker') return dockerVersion ? 'docker' : 'none';
  if (c.mode === 'local') return c.allowLocalCommands ? 'local' : 'none';
  if (c.mode === 'boat') return c.boatApiKey || env.BOAT_API_KEY ? 'boat' : 'none';
  return 'none';
}

export const NO_COMPUTER_HINT = 'Modo sem computador: nesta instalação você não roda comandos, não abre navegador nem cria arquivos numa máquina. Pesquisa na web, memória e conversa funcionam. Se pedirem algo que precise de computador, diga isso em uma frase e sugira ligar o Docker (Configurações → Computador).';
