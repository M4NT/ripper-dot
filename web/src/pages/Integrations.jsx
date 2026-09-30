import { useEffect } from 'react';

/** Rota legada: integrações vivem no Marketplace e em Conectores. */
export default function Integrations() {
  useEffect(() => { location.replace('#/marketplace'); }, []);
  return null;
}
