/** Ícone de marca do catálogo (SVG em /marketplace/). */
export default function BrandIcon({ id, size = 40, className = '' }) {
  const src = `/marketplace/${id}.svg`;
  return (
    <span className={`mp-icon ${className}`} style={{ width: size, height: size }}>
      <img src={src} alt="" width={size} height={size} loading="lazy" />
    </span>
  );
}
