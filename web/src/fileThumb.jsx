import { useState } from 'react';

/** Miniatura de imagem: carrega sob demanda e entra com um fade quando fica pronta. */
export default function FileThumb({ src, size = 44, alt = '' }) {
  const [ready, setReady] = useState(false);
  return (
    <span className={`thumb img-thumb ${ready ? 'ready' : ''}`} style={{ width: size, height: size }}>
      <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setReady(true)} />
    </span>
  );
}
