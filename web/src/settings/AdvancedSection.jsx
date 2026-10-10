import { useApp } from '../app.jsx';
import { Switch } from '../ui.jsx';
import { Card, Row } from './shared.jsx';

export default function AdvancedSection({ s, set }) {
  const { S } = useApp();
  return (
    <Card title="Enterprise" desc="Flags locais desta instalação. Úteis para liberar UI ou APIs experimentais sem trocar de branch.">
      {(S.meta?.flags?.catalog || []).map(({ key, label, desc }) => (
        <Row key={key} title={label} desc={desc}>
          <Switch
            checked={s.flags?.[key] === true}
            onChange={v => set('flags', { ...(s.flags || {}), [key]: v })}
            label={label}
          />
        </Row>
      ))}
      <Row title="Flags personalizadas" desc="Quando ligado, chaves extras booleanas em settings.flags são preservadas (via API ou backup). A interface só lista as conhecidas.">
        <Switch
          checked={s.flags?.allowCustom === true}
          onChange={v => set('flags', { ...(s.flags || {}), allowCustom: v })}
          label="Permitir flags personalizadas"
        />
      </Row>
    </Card>
  );
}
