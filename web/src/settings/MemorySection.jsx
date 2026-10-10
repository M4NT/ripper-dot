import { Icon, Switch } from '../ui.jsx';
import { AdvancedBlock } from '../disclosure.jsx';
import { go } from '../lib.js';
import { useApp } from '../app.jsx';
import { isEnterpriseMode } from '../uiMode.js';
import { Card, Row } from './shared.jsx';

export default function MemorySection({ s, set }) {
  const { S } = useApp();
  const enterprise = isEnterpriseMode(S.settings);
  return (
    <>
      <Card>
        <Row title="Memória" desc="Deixa os agentes guardarem fatos úteis e usarem em conversas futuras."><Switch checked={s.memory} onChange={v => set('memory', v)} label="Memória" /></Row>
        <AdvancedBlock settings={s} hint="Quantos registros entram no contexto" className="in-card">
          <Row title="Registro recente no contexto" desc="Quantas anotações datadas (as mais novas) entram em cada conversa. O perfil estável entra sempre."><div className="input-unit"><input className="input" type="number" min={0} max={50} value={s.memoryLogInContext ?? 10} onChange={e => set('memoryLogInContext', +e.target.value)} /><span>itens</span></div></Row>
        </AdvancedBlock>
        <AdvancedBlock settings={s} hint="Resume histórico longo só no envio ao modelo" className="in-card">
          <Row title="Poda dinâmica de contexto" desc="Antes de enviar ao modelo, resume mensagens antigas quando o histórico passa dos limites abaixo. As últimas trocas ficam intactas; o chat salvo não é alterado."><Switch checked={!!s.contextPruning?.enabled} onChange={v => set('contextPruning', { ...(s.contextPruning || {}), enabled: v })} label="Poda de contexto" /></Row>
          {s.contextPruning?.enabled && <>
            <Row title="Limite de mensagens" desc="Acima disso, mensagens mais antigas viram um resumo no envio."><div className="input-unit"><input className="input" type="number" min={8} max={200} value={s.contextPruning?.maxMessages ?? 48} onChange={e => set('contextPruning', { ...(s.contextPruning || {}), enabled: true, maxMessages: +e.target.value })} /><span>mensagens</span></div></Row>
            <Row title="Limite estimado de tokens" desc="Estimativa local (~4 caracteres por token) sobre o histórico enviado."><div className="input-unit"><input className="input" type="number" min={2000} max={500000} step={1000} value={s.contextPruning?.maxTokens ?? 32000} onChange={e => set('contextPruning', { ...(s.contextPruning || {}), enabled: true, maxTokens: +e.target.value })} /><span>tokens</span></div></Row>
            <Row title="Trocas recentes intactas" desc="Quantas mensagens do fim do histórico nunca entram no resumo."><div className="input-unit"><input className="input" type="number" min={2} max={100} value={s.contextPruning?.keepRecent ?? 14} onChange={e => set('contextPruning', { ...(s.contextPruning || {}), enabled: true, keepRecent: +e.target.value })} /><span>mensagens</span></div></Row>
          </>}
        </AdvancedBlock>
      </Card>
      {enterprise && (
        <Card title="Como funciona" desc="Perfil: fatos estáveis sobre você (preferências, contexto). Registro: anotações datadas do que aconteceu. Gerencie tudo na Biblioteca.">
          <div className="set-actions"><button className="btn" onClick={() => go('/library')}><Icon name="book" size={16} />Abrir Biblioteca</button></div>
        </Card>
      )}
    </>
  );
}
