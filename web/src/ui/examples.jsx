import { useMemo, useState } from 'react';
import { BottomSheet, Card, EmptyState, ErrorState, Icon, Skeleton, VirtualList } from '../ui.jsx';

const MIL = Array.from({ length: 10_000 }, (_, i) => ({
  id: 'm' + i,
  title: 'Mensagem ' + (i + 1),
  extra: i % 7 === 0,
}));

/** Galeria dos primitivos — não é tela do produto; serve de exemplo e de prova visual. */
export function UiExamples() {
  const [sheet, setSheet] = useState(false);
  const [retry, setRetry] = useState(0);
  const itens = useMemo(() => MIL, []);

  return (
    <div className="ui-ex">
      <header>
        <h1>Primitivos de UI</h1>
        <p className="ui-ex-lead">Base Grok Bot: esqueleto, vazio, erro, cartão, folha de baixo e lista virtual. As telas ainda não usam isto.</p>
      </header>

      <section className="ui-ex-section">
        <h2>Skeleton</h2>
        <div className="ui-ex-grid cols-2">
          <Skeleton rows={3} label="Carregando lista" />
          <Skeleton variant="message" rows={4} label="Carregando mensagens" />
          <Skeleton variant="panel" rows={5} label="Carregando painel" />
        </div>
      </section>

      <section className="ui-ex-section">
        <h2>EmptyState</h2>
        <div className="ui-ex-grid cols-2">
          <EmptyState title="Nenhuma conversa ainda" body="Comece falando com um agente." />
          <EmptyState
            title="Sala vazia"
            body="Diga oi para acordar o agente. Depois as mensagens aparecem aqui."
            icon={<Icon name="chat" size={22} />}
            action={<button type="button" className="btn btn-primary">Diga oi</button>}
          />
        </div>
      </section>

      <section className="ui-ex-section">
        <h2>ErrorState</h2>
        <ErrorState
          title="Não deu para carregar a conversa"
          body="A rede caiu no meio do caminho. Nada foi perdido."
          onRetry={() => setRetry(n => n + 1)}
          details={'GET /api/chats/abc\nTypeError: Failed to fetch\n#' + retry}
        />
      </section>

      <section className="ui-ex-section">
        <h2>Card</h2>
        <div className="ui-ex-grid cols-2">
          <Card status="pending">
            <p><b>Aprovar envio</b></p>
            <p className="muted">O agente quer mandar o e-mail. Nada sai sem o seu ok.</p>
          </Card>
          <Card status="ok">
            <p><b>Rotina ligada</b></p>
            <p className="muted">Próxima execução amanhã às 9h.</p>
          </Card>
          <Card status="err">
            <p><b>Conexão falhou</b></p>
            <p className="muted">O conector do Gmail não respondeu.</p>
          </Card>
        </div>
      </section>

      <section className="ui-ex-section">
        <h2>BottomSheet</h2>
        <button type="button" className="btn btn-primary" onClick={() => setSheet(true)}>Abrir painel</button>
        <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Painel do agente" label="Painel do agente">
          <p className="muted">No celular o painel lateral vira esta folha. Arraste para baixo, aperte Esc ou toque fora.</p>
          <p style={{ marginTop: 12 }}>Abas: Visão geral · Rotinas · Mídia · Computador · Membros</p>
        </BottomSheet>
      </section>

      <section className="ui-ex-section">
        <h2>VirtualList · 10.000 itens</h2>
        <p className="muted">Só a janela visível entra no DOM. Âncora no fim: as últimas mensagens ficam na tela.</p>
        <VirtualList
          className="ui-ex-vlist"
          items={itens}
          followEnd
          estimateSize={64}
          renderItem={item => (
            <div className="ui-ex-row" style={item.extra ? { paddingTop: 18, paddingBottom: 18 } : undefined}>
              {item.title}
              {item.extra && <small>Altura variável — duas linhas neste item.</small>}
            </div>
          )}
        />
      </section>
    </div>
  );
}
