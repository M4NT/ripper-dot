import { lazy, Suspense } from 'react';
import { useDark } from './lib.js';

// Efeito da img-fx (MIT) enquanto a imagem nasce; o three.js só é baixado quando alguém gera uma imagem.
const ImageGeneration = lazy(() => import('img-fx').then(m => ({ default: m.ImageGeneration })));

export default function ImageGenLoader() {
  const dark = useDark();
  return (
    <div className="img-gen" role="status" aria-label="Gerando imagem">
      <Suspense fallback={<div className="img-gen-card" />}>
        <ImageGeneration preset="pixels-organic" theme={dark ? 'dark' : 'light'}><div className="img-gen-card" /></ImageGeneration>
      </Suspense>
      <span className="muted small">Gerando a imagem. Leva alguns minutos.</span>
    </div>
  );
}
