import { useEffect, useState } from 'react';
import { useApp } from '../app.jsx';
import { useOv } from '../overlay.jsx';
import { api, go } from '../lib.js';
import { Icon, Switch, Select } from '../ui.jsx';
import { AdvancedBlock } from '../disclosure.jsx';
import { ApprovalHistory } from '../approvals.jsx';
import { isEnterpriseMode } from '../uiMode.js';
import { useT } from '../i18n/index.jsx';
import { Card, Row } from './shared.jsx';

export default function SecuritySection({ s, set }) {
  const { S, refresh, toast } = useApp();
  const ov = useOv();
  const tr = useT();
  const enterprise = isEnterpriseMode(S.settings);
  const [sandboxSt, setSandboxSt] = useState(null);
  useEffect(() => {
    api('/api/sandbox/status').then(setSandboxSt).catch(() => setSandboxSt(null));
  }, []);
  return (
    <>
      <Card
        title="Sandbox Docker"
        badge={sandboxSt == null ? <span className="tag" role="status">Verificando…</span> : sandboxSt.ready ? <span className="tag tag-ok">Pronto</span> : <span className="tag tag-warn">Docker ausente</span>}
        desc="Isola comandos do modo Pasta local em contêiner efêmero (sem privileged, sem rede do host por padrão). Modos Docker e boat.dev já rodam fora do host.">
        <Row title="Ativar sandbox" desc="Comandos no computador local usam docker run --rm em vez do shell do host.">
          <Switch checked={!!s.sandbox?.enabled} onChange={v => set('sandbox', { enabled: false, image: 'node:22-alpine', network: 'none', memory: '512m', cpus: '1', timeoutSeconds: 300, ...s.sandbox, enabled: v })} label="Sandbox Docker" />
        </Row>
        {s.sandbox?.enabled && (
          <>
            {sandboxSt?.fallback && <p className="form-error" role="alert">{sandboxSt.fallback}</p>}
            <Row title="Imagem" desc="Padrão leve com Node (node:22-alpine)."><input className="input mono" value={s.sandbox?.image || 'node:22-alpine'} onChange={e => set('sandbox', { ...s.sandbox, image: e.target.value })} /></Row>
            <Row title="Rede" desc="none isola da rede; bridge permite saída (menos seguro).">
              <Select label="Rede do contêiner" value={s.sandbox?.network || 'none'} onChange={v => set('sandbox', { ...s.sandbox, network: v })} options={[{ value: 'none', label: 'Nenhuma (recomendado)' }, { value: 'bridge', label: 'Bridge' }]} />
            </Row>
            <Row title="Memória / CPUs"><div className="row gap"><input className="input" value={s.sandbox?.memory || '512m'} onChange={e => set('sandbox', { ...s.sandbox, memory: e.target.value })} aria-label="Limite de memória" /><input className="input" value={s.sandbox?.cpus ?? '1'} onChange={e => set('sandbox', { ...s.sandbox, cpus: e.target.value })} aria-label="Limite de CPUs" /></div></Row>
            <Row title="Timeout por comando"><div className="input-unit"><input className="input" type="number" min={5} max={3600} value={s.sandbox?.timeoutSeconds ?? 300} onChange={e => set('sandbox', { ...s.sandbox, timeoutSeconds: +e.target.value })} /><span>seg</span></div></Row>
          </>
        )}
      </Card>
      <Card title={tr('settings.security.approvalTitle')} desc={tr('settings.security.approvalDesc')}>
        <div className="mode-grid three">
          {[['risky', tr('settings.security.approval.risky'), tr('settings.security.approval.riskyTag'), tr('settings.security.approval.riskyDesc')],
            ['always', tr('settings.security.approval.always'), '', tr('settings.security.approval.alwaysDesc')],
            ['never', tr('settings.security.approval.never'), tr('settings.security.approval.neverTag'), tr('settings.security.approval.neverDesc')]].map(([k, tit, tag, dsc]) => (
            <button key={k} type="button" className={`mode ${(s.approvalPolicy || 'risky') === k ? 'on' : ''}`} onClick={() => set('approvalPolicy', k)} aria-pressed={(s.approvalPolicy || 'risky') === k}
              title={k === 'never' ? 'Comandos destrutivos podem rodar sem pausa. Use só se confia em tudo que o agente faz.' : undefined}>
              <b>{tit}{tag && <span className={`tag ${k === 'risky' ? 'tag-ok' : 'tag-warn'}`}>{tag}</span>}</b><small>{dsc}</small>
            </button>
          ))}
        </div>
      </Card>
      <Card title="LGPD — dados pessoais" desc="Se você ligar, antes de mandar qualquer texto para a IA o Ripper troca CPF, contas, documentos e contatos por marcadores. Aqui no seu computador, as conversas continuam com o texto original.">
        <Row title="Exportar tudo" desc="Um pacote com tudo em formato fácil de abrir: conversas, agentes, rotinas e arquivos. Senhas e chaves ficam de fora.">
          <a className="btn" href="/api/data/export-all" download><Icon name="download" size={16} />Baixar pacote</a>
        </Row>
        <Row title="Esconder dados pessoais da IA" desc="Recomendado se você cola dados de clientes no chat."><Switch checked={!!s.lgpd?.enabled} onChange={v => set('lgpd', { ...(s.lgpd || {}), enabled: v })} label="Esconder dados pessoais da IA" /></Row>
        {s.lgpd?.enabled && <>
          <Row title="Também em avisos do servidor" desc="SSE warn/erro e logs do Node quando ligado."><Switch checked={!!s.lgpd?.redactInLogs} onChange={v => set('lgpd', { ...(s.lgpd || {}), redactInLogs: v })} label="Mascarar PII em logs" /></Row>
          <Row title="Eliminar meus dados" desc="Direito de eliminação (art. 18): apaga conversas, memórias, anexos e telemetria local. Agentes e plugins permanecem.">
            <button type="button" className="btn btn-danger" onClick={async () => {
              if (!(await ov.confirm({ title: 'Eliminar meus dados?', body: 'Apaga conversas, memórias, anexos e seu nome/instruções. Não dá para desfazer.', action: 'Eliminar', danger: true }))) return;
              try {
                await api('/api/lgpd/erasure', { method: 'POST', body: { confirm: 'ERASE', scope: 'all' } });
                await refresh();
                toast('Dados pessoais eliminados nesta instalação');
              } catch (e) { toast(e.message, 'error'); }
            }}>Solicitar eliminação</button>
          </Row>
        </>}
      </Card>
      {enterprise && <>
        <Card title={tr('settings.security.historyTitle')} desc={tr('settings.security.historyDesc')}>
          <ApprovalHistory limit={15} />
        </Card>
        {s.flags?.socialWebhooks && (
          <Card title="Publicação social" desc="Webhooks HTTP para posts externos. Tokens na URL são armazenados localmente; publicar pede aprovação nas políticas acima (exceto “Nunca pedir” ou autonomia total no Enterprise).">
            <div className="set-actions"><button type="button" className="btn btn-sm" onClick={() => go('/connectors')}><Icon name="share" size={16} />Gerenciar webhooks sociais</button></div>
          </Card>
        )}
        <AdvancedBlock settings={s} hint="Limite de taxa">
          <Card title="Limite de taxa" desc="Evita loops acidentais no chat e em APIs pesadas (backup, restore, export de metering). Contadores ficam na memória deste processo — várias réplicas não compartilham o mesmo limite. Variáveis RIPPER_RATE_* no servidor têm prioridade.">
            <Row title="Ativar limite de taxa" desc="Respostas 429 com Retry-After quando exceder."><Switch checked={!!s.rateLimit?.enabled} onChange={v => set('rateLimit', { ...(s.rateLimit || {}), enabled: v })} label="Limite de taxa" /></Row>
            <Row title="Chat (POST /api/chat)" desc="Por token e por IP na janela abaixo."><div className="input-unit"><input className="input" type="number" min={1} max={10000} value={s.rateLimit?.chatPerMinute ?? 30} onChange={e => set('rateLimit', { ...(s.rateLimit || {}), chatPerMinute: +e.target.value })} /><span>req / janela</span></div></Row>
            <Row title="APIs pesadas" desc="Backup, restore, export de metering e rotas de teste de carga."><div className="input-unit"><input className="input" type="number" min={1} max={10000} value={s.rateLimit?.apiPerMinute ?? 20} onChange={e => set('rateLimit', { ...(s.rateLimit || {}), apiPerMinute: +e.target.value })} /><span>req / janela</span></div></Row>
            <Row title="Janela" desc="Duração da janela em memória."><div className="input-unit"><input className="input" type="number" min={1} max={3600} value={Math.round((s.rateLimit?.windowMs ?? 60000) / 1000)} onChange={e => set('rateLimit', { ...(s.rateLimit || {}), windowMs: +e.target.value * 1000 })} /><span>segundos</span></div></Row>
          </Card>
        </AdvancedBlock>
        <AdvancedBlock settings={s} hint="Limites de mensagens entre agentes">
          <Card title={tr('settings.security.inboxTitle')} desc={tr('settings.security.inboxDesc')}>
            <Row title="Máximo por agente, por hora"><div className="input-unit"><input className="input" type="number" min={1} max={200} value={s.inbox?.maxPerHour ?? 20} onChange={e => set('inbox', { ...(s.inbox || {}), maxPerHour: +e.target.value })} /><span>mensagens</span></div></Row>
            <Row title="Profundidade máxima de uma troca" desc="Quantas vezes uma resposta pode gerar outra mensagem (saltos inbox)." tip="Valores altos podem gerar longas cadeias de mensagens automáticas entre agentes."><div className="input-unit"><input className="input" type="number" min={1} max={10} value={s.inbox?.maxHops ?? 3} onChange={e => set('inbox', { ...(s.inbox || {}), maxHops: +e.target.value })} /><span>saltos</span></div></Row>
            <Row title="Timeout de call_agent" desc="Quanto esperar por uma chamada síncrona entre agentes (5–300 s)."><div className="input-unit"><input className="input" type="number" min={5} max={300} value={s.inbox?.callTimeoutSeconds ?? 120} onChange={e => set('inbox', { ...(s.inbox || {}), callTimeoutSeconds: +e.target.value })} /><span>segundos</span></div></Row>
          </Card>
        </AdvancedBlock>
        <AdvancedBlock settings={s} hint="Chaos / testes de resiliência">
          <Card title="Chaos / testes de resiliência" desc="Simula falhas controladas para validar fallbacks. Desligado por padrão; nunca use em produção real.">
            <div className="chaos-banner" role="alert">
              <strong>Atenção:</strong> com chaos ativo, conversas e conectores MCP podem falhar ou ficar lentos de propósito. Só ligue em ambiente de desenvolvimento ou teste.
            </div>
            <Row title="Ativar chaos" desc="Requer NODE_ENV ≠ production ou RIPPER_CHAOS_ALLOW_PROD=1 no servidor.">
              <Switch checked={!!s.chaos?.enabled} onChange={v => set('chaos', { ...(s.chaos || {}), enabled: v })} label="Chaos ativo" />
            </Row>
            <Row title="Taxa de falha do provedor" desc="0 = nunca; 1 = sempre (antes de chamar o modelo).">
              <div className="input-unit"><input className="input" type="number" min={0} max={1} step={0.05} disabled={!s.chaos?.enabled} value={s.chaos?.providerFailRate ?? 0} onChange={e => set('chaos', { ...(s.chaos || {}), providerFailRate: +e.target.value })} /><span>0–1</span></div>
            </Row>
            <Row title="Atraso SSE" desc="Milissegundos extras antes de cada evento enviado ao navegador.">
              <div className="input-unit"><input className="input" type="number" min={0} max={60000} disabled={!s.chaos?.enabled} value={s.chaos?.sseDelayMs ?? 0} onChange={e => set('chaos', { ...(s.chaos || {}), sseDelayMs: +e.target.value })} /><span>ms</span></div>
            </Row>
            <Row title="Desconectar MCP" desc="Próximas sondas MCP e chamadas da ponte ripper falham como se a sessão tivesse caído.">
              <Switch checked={!!s.chaos?.mcpDisconnect} disabled={!s.chaos?.enabled} onChange={v => set('chaos', { ...(s.chaos || {}), mcpDisconnect: v })} label="Simular queda MCP" />
            </Row>
          </Card>
        </AdvancedBlock>
      </>}
      <Card title="Retenção de dados" desc="Apaga automaticamente conversas, eventos de uso, histórico de aprovações em db.json, artefatos e anexos órfãos após o prazo. Hard-delete no disco. Não altera audit-trail.sqlite (WORM), se existir.">
        <Row title="Retenção automática" desc="Job periódico no servidor (padrão a cada 6 h)."><Switch checked={!!s.retention?.enabled} onChange={v => set('retention', { ...(s.retention || {}), enabled: v })} label="Ativar retenção" /></Row>
        <Row title="Conversas" desc="Usa a data da última mensagem (updatedAt)."><div className="input-unit"><input className="input" type="number" min={1} max={3650} value={s.retention?.chatDays ?? 90} onChange={e => set('retention', { ...(s.retention || {}), chatDays: +e.target.value })} /><span>dias</span></div></Row>
        <Row title="Eventos de uso" desc="Linhas em usage.sqlite (não os contadores em db.json)."><div className="input-unit"><input className="input" type="number" min={1} max={3650} value={s.retention?.usageEventsDays ?? 90} onChange={e => set('retention', { ...(s.retention || {}), usageEventsDays: +e.target.value })} /><span>dias</span></div></Row>
        <Row title="Auditoria local" desc="Entradas em db.json (auditLog). WORM audit-trail.sqlite nunca é apagado aqui."><div className="input-unit"><input className="input" type="number" min={1} max={3650} value={s.retention?.auditDays ?? 180} onChange={e => set('retention', { ...(s.retention || {}), auditDays: +e.target.value })} /><span>dias</span></div></Row>
        <Row title="Artefatos e anexos" desc="Metadados em db.json, blobs em artifacts/ e uploads órfãos."><div className="input-unit"><input className="input" type="number" min={1} max={3650} value={s.retention?.artifactsDays ?? 90} onChange={e => set('retention', { ...(s.retention || {}), artifactsDays: +e.target.value })} /><span>dias</span></div></Row>
        {s.retention?.lastPurgeAt && (
          <Row title="Última purga" desc={s.retention.lastReport ? `${s.retention.lastReport.chats ?? 0} conversas, ${s.retention.lastReport.usageEvents ?? 0} eventos de uso, ${s.retention.lastReport.auditLog ?? 0} auditoria, ${s.retention.lastReport.artifacts ?? 0} artefatos.` : ''}>
            <span className="muted">{new Date(s.retention.lastPurgeAt).toLocaleString('pt-BR')}</span>
          </Row>
        )}
      </Card>
    </>
  );
}
