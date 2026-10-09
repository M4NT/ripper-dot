// Biblioteca completa do OpenUI (MIT, @openuidev/react-ui): junta a biblioteca padrão com a do chat (86 componentes no total).
// Usada pelo servidor (instruções do modelo) e pela tela (desenho), para os dois lados falarem a mesma língua.
import { openuiLibrary, openuiChatLibrary } from '@openuidev/react-ui';
import { createLibrary } from '@openuidev/react-lang';

const todos = { ...openuiChatLibrary.components, ...openuiLibrary.components };
export const openuiTudo = createLibrary({ components: Object.values(todos), root: openuiLibrary.root });
