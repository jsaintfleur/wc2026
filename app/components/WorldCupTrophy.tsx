/**
 * FIFA World Cup Trophy — uses the official 2026 branded image
 * with transparent background. Trophy over "26" block numbers.
 */
export default function WorldCupTrophy({
  className,
}: {
  id?: string;
  className?: string;
}) {
  return (
    <img
      src="/trophy.png"
      alt="FIFA World Cup Trophy"
      className={className}
      draggable={false}
    />
  );
}
