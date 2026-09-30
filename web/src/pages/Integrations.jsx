import { useEffect } from 'react';

/** Integrações agora são abas de Configurações; este endereço antigo só redireciona. */
export default function Integrations() {
  useEffect(() => { location.replace('#/settings/models'); }, []);
  return null;
}
