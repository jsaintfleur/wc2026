export default function WorldCupTrophy({
  id = "wc-trophy",
  className,
}: {
  id?: string;
  className?: string;
}) {
  const gold = `${id}-gold`;
  const glow = `${id}-glow`;
  const dark = `${id}-dark`;

  return (
    <svg
      id={id}
      role="img"
      aria-label="World Cup trophy silhouette"
      className={className}
      viewBox="0 0 140 220"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gold} x1="26" y1="18" x2="116" y2="200" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff3b6" />
          <stop offset="0.28" stopColor="#f8c74a" />
          <stop offset="0.6" stopColor="#c98616" />
          <stop offset="1" stopColor="#ffdf72" />
        </linearGradient>
        <linearGradient id={dark} x1="45" y1="66" x2="96" y2="158" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#111827" stopOpacity="0.9" />
          <stop offset="1" stopColor="#062318" stopOpacity="0.72" />
        </linearGradient>
        <filter id={glow} x="-35%" y="-25%" width="170%" height="150%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="10" stdDeviation="8" floodColor="#f59e0b" floodOpacity="0.28" />
          <feDropShadow dx="0" dy="22" stdDeviation="15" floodColor="#000000" floodOpacity="0.38" />
        </filter>
      </defs>

      <g filter={`url(#${glow})`}>
        <path
          d="M70 8c22 0 40 14 41 33 1 16-9 29-25 36 13 15 18 37 14 58-4 18-13 31-25 39h27c5 0 9 4 9 9v7H29v-7c0-5 4-9 9-9h27c-12-8-21-21-25-39-4-21 1-43 14-58-16-7-26-20-25-36C30 22 48 8 70 8Z"
          fill={`url(#${gold})`}
        />
        <path
          d="M50 78c11 8 17 24 19 49 1 13 1 27 1 43M90 78c-11 8-17 24-19 49-1 13-1 27-1 43"
          fill="none"
          stroke="#fff6bf"
          strokeOpacity="0.5"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M47 46c8 8 16 12 25 12 9 1 17-3 24-10-3 15-12 26-24 28-12 1-22-10-25-30Z"
          fill={`url(#${dark})`}
          opacity="0.9"
        />
        <path
          d="M39 188h62l8 20H31l8-20Z"
          fill={`url(#${gold})`}
        />
        <path
          d="M37 194h66"
          stroke="#0f5132"
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M45 204h50"
          stroke="#d12d2d"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.88"
        />
        <path
          d="M51 211h38"
          stroke="#f9d768"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M48 23c-8 5-13 12-14 20M88 22c10 5 16 12 17 22"
          fill="none"
          stroke="#fff8d0"
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.58"
        />
      </g>
    </svg>
  );
}
