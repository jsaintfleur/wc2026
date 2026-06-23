export default function WorldCupTrophy({
  className,
}: {
  id?: string;
  className?: string;
}) {
  return (
    <img
      src="/world-cup-26-mark.png"
      alt="FIFA World Cup 26 mark"
      className={className}
      draggable={false}
    />
  );
}
