import { useState } from 'react';
import { Icon } from '../ui.jsx';

const FALLBACK = {
  plug: 'plug',
  terminal: 'terminal',
  bulb: 'bulb',
  cube: 'cube'
};

/** Ícone de marca do catálogo (SVG em /marketplace/). */
export default function BrandIcon({ id, size = 40, className = '' }) {
  const [broken, setBroken] = useState(false);
  const stroke = FALLBACK[id];
  if (broken || stroke) {
    return (
      <span className={`mp-icon line ${className}`} style={{ width: size, height: size }}>
        <Icon name={stroke || 'grid'} size={size * 0.45} />
      </span>
    );
  }
  const src = `/marketplace/${id}.svg`;
  return (
    <span className={`mp-icon ${className}`} style={{ width: size, height: size }}>
      <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}
