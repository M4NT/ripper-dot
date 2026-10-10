import { useEffect, useState, useRef } from 'react';
import { useApp } from '../app.jsx';
import { useOv } from '../overlay.jsx';
import { api } from '../lib.js';
import { Icon, Switch } from '../ui.jsx';
import { Card, Row } from './shared.jsx';

function DataBackup({ s, set }) {
  const { refresh, toast } = useApp();
  const ov = useOv();
  const [auto, setAuto] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);
  const reloadList = () => api('/api/backup/list').then(r => {
    setAuto(r.auto || []);
    setSnapshots(r.snapshots || []);
  }).catch(() => { setAuto([]); setSnapshots([]); });
  useEffect(() => { reloadList(); }, []);
  const download = async () => {
    setBusy('export');
    try {
      const snap = await api('/api/data/backup');
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ripper-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Arquivo baixado. Guarde em lugar seguro: tem suas conversas.');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const createSnapshot = async () => {
    setBusy('snapshot');
    try {
      await api('/api/backup', { method: 'POST' });
      await reloadList();
      toast('Cópia completa feita');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const restoreSnapshot = async id => {
    if (!(await ov.confirm({ title: 'Restaurar esta cópia?', body: 'Seus agentes, conversas e configurações atuais serão trocados pelos desta cópia.', action: 'Restaurar', danger: true }))) return;
    setBusy(`restore-${id}`);
    try {
      await api('/api/backup/restore', { method: 'POST', body: { confirm: true, id } });
      await refresh();
      await reloadList();
      toast('Dados restaurados');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const restoreJson = async file => {
    if (!file) return;
    setBusy('import');
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      await api('/api/data/restore', { method: 'POST', body: { confirm: true, backup } });
      await refresh();
      toast('Agentes e conversas restaurados');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };
  const backup = s.backup || { enabled: true, intervalHours: 24, keepCount: 7 };
  return (
    <>
      <Card title="Cópia completa dos dados" desc="Guarda tudo: agentes, conversas, configurações, arquivos e histórico de uso. Restaurar uma cópia troca os dados atuais pelos dela.">
        <Row title="Backup manual">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={createSnapshot} aria-busy={busy === 'snapshot'}>{busy === 'snapshot' ? 'Criando…' : 'Fazer uma cópia agora'}</button>
        </Row>
        <Row title="Cópia automática" desc="O Ripper faz cópias sozinho; as mais antigas são apagadas para não encher o disco.">
          <Switch checked={!!backup.enabled} onChange={v => set('backup', { ...backup, enabled: v })} label="Backup automático" />
        </Row>
        {backup.enabled && <>
          <Row title="Intervalo"><div className="input-unit"><input className="input" type="number" min={1} max={168} value={backup.intervalHours ?? 24} onChange={e => set('backup', { ...backup, intervalHours: +e.target.value })} /><span>horas</span></div></Row>
          <Row title="Manter no disco"><div className="input-unit"><input className="input" type="number" min={1} max={50} value={backup.keepCount ?? 7} onChange={e => set('backup', { ...backup, keepCount: +e.target.value })} /><span>cópias</span></div></Row>
          <Row title="Cópia extra em outra pasta" desc="Recomendado: uma pasta sincronizada (OneDrive, Google Drive, Dropbox) ou um disco externo. Assim, se este disco falhar, o backup não vai junto. Caminho completo; deixe vazio para não copiar." stack>
            <input className="input" value={backup.copyTo || ''} onChange={e => set('backup', { ...backup, copyTo: e.target.value })} placeholder="Ex.: C:\Users\voce\OneDrive\Ripper-backups" aria-label="Pasta da cópia extra" />
          </Row>
        </>}
        <Row title="Último backup">{snapshots[0] ? <span>{new Date(snapshots[0].createdAt).toLocaleString('pt-BR')} · {(snapshots[0].bytes / 1048576).toFixed(1).replace('.', ',')} MB</span> : <span className="tag tag-warn">nenhum ainda</span>}</Row>
        {snapshots.length > 0 && (
          <Row title="Cópias guardadas" stack>
            <ul className="rows flat">
              {snapshots.map(row => (
                <li key={row.id} className="row-item">
                  <div className="row-main"><b className="mono small">{row.fileName}</b><small>{new Date(row.createdAt).toLocaleString()} · {(row.bytes / 1024).toFixed(1)} KB</small></div>
                  <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => restoreSnapshot(row.id)} aria-busy={busy === `restore-${row.id}`}>Restaurar</button>
                </li>
              ))}
            </ul>
          </Row>
        )}
      </Card>
      <Card title="Arquivo leve de agentes e conversas" desc="Um arquivo pequeno com agentes, conversas e configurações, sem os arquivos anexados. Bom para levar para outro computador.">
        <Row title="Baixar">
          <button type="button" className="btn" disabled={!!busy} onClick={download} aria-busy={busy === 'export'}>{busy === 'export' ? 'Gerando…' : 'Baixar arquivo'}</button>
        </Row>
        <Row title="Restaurar de um arquivo" desc="Antes de trocar, o Ripper guarda uma cópia do que você tem hoje." tip="Substitui conversas e configurações atuais. Guarde o arquivo em lugar seguro.">
          <div className="row">
            <input ref={fileRef} type="file" hidden accept="application/json,.json" onChange={e => restoreJson(e.target.files?.[0])} />
            <button type="button" className="btn" disabled={!!busy} onClick={() => fileRef.current?.click()} aria-busy={busy === 'import'}><Icon name="upload" size={16} />{busy === 'import' ? 'Restaurando…' : 'Escolher arquivo…'}</button>
          </div>
        </Row>
        {auto?.length > 0 && (
          <Row title="Cópias de segurança automáticas" desc="Feitas antes de atualizações e restaurações." stack>
            <ul className="rows flat">{auto.map(n => <li key={n} className="row-item"><div className="row-main"><b className="mono small">{n}</b></div></li>)}</ul>
          </Row>
        )}
      </Card>
    </>
  );
}

/** Versão do Ripper: confere se há nova, mostra as novidades e atualiza com um clique. */
function UpdateCard() {
  const { toast } = useApp();
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);
  const load = (check = false) => { setChecking(check); return api(`/api/update${check ? '?check=1' : ''}`).then(setInfo).catch(e => toast(e.message, 'error')).finally(() => setChecking(false)); };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!info?.applying || info.applying.done || info.applying.error) return;
    const t = setInterval(() => api('/api/update').then(setInfo).catch(() => { clearInterval(t); setTimeout(() => location.reload(), 4000); }), 2000);
    return () => clearInterval(t);
  }, [info?.applying?.step]);
  const apply = () => api('/api/update', { method: 'POST' }).then(r => setInfo(i => ({ ...i, ...r }))).catch(e => toast(e.message, 'error'));
  const a = info?.applying;
  return (
    <Card title="Versão do Ripper" desc={info?.reason === 'no-git' ? 'Esta instalação não veio do Git; atualize baixando a versão nova.' : info?.reason === 'offline' ? 'Não consegui conferir a versão oficial agora (sem internet ou sem acesso ao repositório).' : info?.current ? `Versão instalada: ${info.current}` : 'Conferindo…'}>
      {info?.available && <>
        <p className="small"><b>{info.behind} novidade{info.behind > 1 ? 's' : ''}</b> na versão nova:</p>
        <ul className="update-notes">{info.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </>}
      {info?.current && !info.available && !a && <p className="small muted">Você está na versão mais recente.</p>}
      {a && <p className={`small ${a.error ? 'warn-text' : 'muted'}`}>{a.step}{!a.done && !a.error ? '…' : ''}</p>}
      <div className="row-actions">
        {info?.available && !a && <button className="btn btn-primary" onClick={apply}><Icon name="download" size={15} />Atualizar agora</button>}
        <button className="btn" disabled={checking || (a && !a.error && !a.done)} onClick={() => load(true)}>{checking ? 'Conferindo…' : 'Procurar versão nova'}</button>
      </div>
      {info?.available && !info.supervised && !a && <p className="small muted">O Ripper não está rodando como serviço: depois de atualizar, feche e abra de novo.</p>}
    </Card>
  );
}

export default function BackupSection({ s, set }) {
  return <><UpdateCard /><DataBackup s={s} set={set} /></>;
}
