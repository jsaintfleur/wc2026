/**
 * Adidas Trionda match ball — uses the official product image
 * rendered as a CSS background so we can scale/position to
 * crop the light background from the product photo.
 */
export default function TriondaBall({
  className,
}: {
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      role="img"
      aria-label="Adidas Trionda — Official Match Ball of FIFA World Cup 2026"
      style={{
        backgroundImage: "url(/trionda.png)",
        backgroundSize: "250%",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
