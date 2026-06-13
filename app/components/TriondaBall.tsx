/**
 * Adidas Trionda match ball — uses the official product image
 * from the FIFA Store with transparent background.
 */
export default function TriondaBall({
  className,
}: {
  id?: string;
  className?: string;
}) {
  return (
    <img
      src="/trionda.png"
      alt="Adidas Trionda — Official Match Ball of FIFA World Cup 2026"
      className={className}
      draggable={false}
    />
  );
}
