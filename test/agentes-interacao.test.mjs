// Interação com os agentes (lote das 50 melhorias): durações, fontes, frases de aprovação, erros,
// números, índice das respostas e rótulos das ferramentas. Funções puras, sem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contextoDoErroTexto, fmtDuracao, fontesDoPasso, fonteDoPasso, fraseDaAprovacao, verbosDaAprovacao } from '../web/src/agentesInteracao.js';
import { markdown, ptNumeros, titulosDo } from '../web/src/markdown.js';
import { motivoDaDemora, rotuloOmie, stepLabel } from '../web/src/lib.js';
import { RIPPER_TOOL_CATALOG } from '../lib/ripper-builtin-tools.mjs';

test('duração da etapa: menos de 1 s, segundos com vírgula e minutos (item 11)', () => {
  assert.equal(fmtDuracao(800), '< 1 s');
  assert.equal(fmtDuracao(1200), '1,2 s');
  assert.equal(fmtDuracao(185_000), '3 min 5 s');
  assert.equal(fmtDuracao(null), null);
});

test('fonte do dado: sistemas (Omie, notas recebidas) aparecem na etapa; a pesquisa não (item 30)', () => {
  assert.equal(fonteDoPasso({ kind: 'tool', tool: 'omie_listar_contas_pagar' }), 'Omie');
  assert.equal(fonteDoPasso({ kind: 'tool', tool: 'dfe_sincronizar' }), 'Notas recebidas');
  assert.equal(fonteDoPasso({ kind: 'tool', tool: 'WebSearch' }), null);
  assert.equal(fonteDoPasso({ kind: 'done', tool: 'omie_listar_contas_pagar' }), null);
});

test('fontes da resposta: páginas abertas, sem repetir e com o domínio (item 23)', () => {
  const fontes = fontesDoPasso([
    { kind: 'tool', tool: 'WebFetch', detail: 'https://www.exemplo.com.br/noticia' },
    { kind: 'tool', tool: 'WebFetch', detail: 'https://www.exemplo.com.br/noticia' },
    { kind: 'tool', tool: 'browser_open', detail: 'https://docs.site.org/guia' },
    { kind: 'tool', tool: 'WebSearch', detail: 'pesquisa sem link' },
    { kind: 'note', label: 'texto' }
  ]);
  assert.deepEqual(fontes.map(f => f.host), ['exemplo.com.br', 'docs.site.org']);
  assert.equal(fontesDoPasso([{ kind: 'tool', tool: 'WebSearch', detail: 'x' }]).length, 0);
});

test('frase da aprovação: e-mail mostra destinatário e assunto; exec e Omie em português simples (itens 31 e 38)', () => {
  const email = { kind: 'email', command: 'Para ana@cliente.com\nAssunto: Proposta de março\n\nOi, Ana.' };
  assert.equal(fraseDaAprovacao(email), 'Para ana@cliente.com · Assunto: Proposta de março');
  assert.equal(fraseDaAprovacao({ kind: 'exec', command: 'rm -rf dist' }), 'Rodar um comando no seu computador.');
  assert.equal(fraseDaAprovacao({ kind: 'omie', command: 'ALTER X' }), 'Alterar dados no seu Omie.');
  assert.equal(fraseDaAprovacao({ kind: 'question', command: 'Qual cliente?\nmais' }), 'Qual cliente?');
});

test('verbos dos botões: o que a ação faz de fato; sem tipo conhecido, Aprovar/Recusar (item 32)', () => {
  assert.deepEqual(verbosDaAprovacao({ kind: 'email' }), { sim: 'Enviar e-mail', nao: 'Não enviar' });
  assert.deepEqual(verbosDaAprovacao({ kind: 'whatsapp' }), { sim: 'Enviar WhatsApp', nao: 'Não enviar' });
  assert.deepEqual(verbosDaAprovacao({ kind: 'desconhecido' }), { sim: 'Aprovar', nao: 'Recusar' });
});

test('contexto do erro: hora, etapa e quantas ações já tinham terminado (itens 39 e 44)', () => {
  const quando = Date.parse('2026-10-09T17:02:00Z'); // 14:02 em Brasília
  assert.equal(contextoDoErroTexto({ quando, etapa: 'Pesquisando na web', feitas: 2 }),
    'Parou às 14:02 na etapa "Pesquisando na web". 2 ações já tinham terminado antes.');
  assert.equal(contextoDoErroTexto({ quando, etapa: null, feitas: 1 }), 'Parou às 14:02. 1 ação já tinha terminado antes.');
  assert.equal(contextoDoErroTexto({}), '');
});

test('números em pt-BR: milhar e decimal sem mexer em versões, links e código (item 26)', () => {
  assert.equal(ptNumeros('2000.5'), '2.000,50');
  assert.equal(ptNumeros('R$ 1234.56 no total'), 'R$ 1.234,56 no total');
  assert.equal(ptNumeros('US$ 1,234.56'), 'US$ 1.234,56');
  assert.equal(ptNumeros('já em 1.234,56'), 'já em 1.234,56');
  assert.equal(ptNumeros('versão v2026.10 e 12.5'), 'versão v2026.10 e 12.5');
  assert.equal(ptNumeros('https://x.com/1234.56'), 'https://x.com/1234.56');
  assert.equal(markdown('valor `1234.56` no código').includes('1234.56'), true);
});

test('índice e âncoras das respostas: títulos numerados em ordem, código fora (item 19)', () => {
  const texto = '## Resumo\n\nTexto.\n\n```\n# não é título\n```\n\n### Detalhe\n\n## Fim';
  assert.deepEqual(titulosDo(texto), [
    { id: 'h0', nivel: 2, texto: 'Resumo' },
    { id: 'h1', nivel: 3, texto: 'Detalhe' },
    { id: 'h2', nivel: 2, texto: 'Fim' }
  ]);
  const html = markdown(texto, 'p-');
  // o renderizador já desce um nível (## vira h3), e a âncora segue a ordem dos títulos
  assert.match(html, /<h3 id="p-h0">Resumo<\/h3>/);
  assert.match(html, /<h4 id="p-h1">Detalhe<\/h4>/);
  assert.match(html, /<h3 id="p-h2">Fim<\/h3>/);
});

test('tabela: o botão de tela cheia fica junto dos botões de copiar (item 20)', () => {
  const html = markdown('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /data-copy-table="md"/);
  assert.match(html, /data-expand-table/);
});

test('rótulos das ferramentas: cada ferramenta do servidor tem nome em português (item 9)', () => {
  for (const nome of Object.keys(RIPPER_TOOL_CATALOG)) {
    if (nome.startsWith('mcp__')) continue;
    assert.notEqual(stepLabel(nome), nome, `falta rótulo para ${nome}`);
  }
  assert.equal(rotuloOmie('omie_listar_contas_pagar'), 'Listando contas pagar no Omie');
  assert.equal(rotuloOmie('omie_incluir_cliente'), 'Incluindo cliente no Omie');
});

test('motivo provável da demora (item 12)', () => {
  assert.equal(motivoDaDemora('Pesquisando na web'), 'esperando o site responder');
  assert.equal(motivoDaDemora('Rodando comando'), 'o comando ainda está rodando');
  assert.equal(motivoDaDemora('Pensando'), 'pensando com calma');
  assert.equal(motivoDaDemora('Outra coisa'), 'ainda trabalhando');
});
