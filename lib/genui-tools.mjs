// Ferramentas show_* geradas do catálogo. Sem efeito colateral: só mostram o cartão.
import { GENUI_CATALOG, GENUI_NAMES, GENUI_TOOL_NAMES, isGenuiTool } from './genui-catalog.mjs';
import { presentGenui } from './genui.mjs';

export { GENUI_TOOL_NAMES, isGenuiTool };

const text = t => ({ content: [{ type: 'text', text: String(t) }] });

function toolDescription(name, entry) {
  return `${entry.description} USE quando: ${entry.when} NÃO USE quando: ${entry.whenNot} Limite: siga o schema. Sem efeito até o usuário agir no cartão.`;
}

export const GENUI_TOOL_CATALOG = Object.fromEntries(GENUI_NAMES.map(name => {
  const entry = GENUI_CATALOG[name];
  return [`show_${name}`, {
    description: toolDescription(name, entry),
    inputSchema: entry.schema.shape
  }];
}));

export function makeGenuiExecute(name, ctx) {
  const component = String(name || '').replace(/^show_/, '');
  return async props => {
    if (typeof ctx.showUi === 'function') return text(await ctx.showUi(component, props));
    const shown = presentGenui({ component, props });
    return text(shown.ok ? JSON.stringify({ shown: true, id: shown.part.id }) : (shown.text || shown.warning));
  };
}

export function buildGenuiTools(ctx) {
  return GENUI_TOOL_NAMES.map(name => ({
    name,
    ...GENUI_TOOL_CATALOG[name],
    execute: makeGenuiExecute(name, ctx)
  }));
}
