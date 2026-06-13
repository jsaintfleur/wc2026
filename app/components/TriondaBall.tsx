/**
 * 3D-rendered SVG ball inspired by the FIFA World Cup 2026 official match ball.
 * Flowing multi-color panel design with realistic sphere shading, specular
 * highlights, and rim lighting. Uses unique gradient IDs per instance to avoid
 * SVG ID collisions when rendered multiple times on the same page.
 */
export default function TriondaBall({ id = "tb", className }: { id?: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Base sphere gradient — warm white with subtle directional light from top-left */}
        <radialGradient id={`${id}-base`} cx="38%" cy="32%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="45%" stopColor="#f0f1f3" />
          <stop offset="78%" stopColor="#d4d7de" />
          <stop offset="100%" stopColor="#b8bcc6" />
        </radialGradient>

        {/* Bottom shadow crescent for grounding the sphere */}
        <radialGradient id={`${id}-floor`} cx="50%" cy="95%" r="55%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.32)" />
          <stop offset="60%" stopColor="rgba(0,0,0,0.08)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Specular highlight — sharp bright spot top-left */}
        <radialGradient id={`${id}-spec`} cx="36%" cy="28%" r="22%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Rim light — subtle edge glow on the bottom-right */}
        <radialGradient id={`${id}-rim`} cx="72%" cy="78%" r="35%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Panel seam texture — very thin darkened groove */}
        <filter id={`${id}-seam`}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.4" />
        </filter>

        <clipPath id={`${id}-clip`}><circle cx="100" cy="100" r="93" /></clipPath>

        {/* Drop shadow beneath the ball */}
        <radialGradient id={`${id}-drop`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.35)" />
          <stop offset="70%" stopColor="rgba(0,0,0,0.08)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>

      {/* Floor shadow ellipse */}
      <ellipse cx="100" cy="192" rx="52" ry="6" fill={`url(#${id}-drop)`} />

      {/* Base sphere */}
      <circle cx="100" cy="100" r="93" fill={`url(#${id}-base)`} />

      {/* Flowing color panels clipped to sphere */}
      <g clipPath={`url(#${id}-clip)`}>

        {/* Panel seam lines — the thin white/grey borders between color zones */}
        <g stroke="rgba(180,185,195,0.3)" strokeWidth="1" fill="none" filter={`url(#${id}-seam)`}>
          <path d="M-10,130 C30,90 60,75 100,72 S170,55 210,35" />
          <path d="M-10,108 C35,72 70,60 110,58 S175,38 215,18" />
          <path d="M-10,155 C25,118 55,100 95,96 S165,78 210,58" />
          <path d="M-10,85 C40,52 75,42 115,42 S180,22 220,5" />
          <path d="M-10,175 C20,140 50,125 90,120 S155,102 210,82" />
        </g>

        {/* ── RED panel — bold swooping band (Canada-inspired) ── */}
        <path d="M-15,140 C25,100 55,82 100,78 S165,58 215,38"
              stroke="#dc2626" strokeWidth="22" fill="none" opacity=".78"
              strokeLinecap="round" />
        <path d="M-15,140 C25,100 55,82 100,78 S165,58 215,38"
              stroke="#ef4444" strokeWidth="10" fill="none" opacity=".4"
              strokeLinecap="round" />

        {/* ── BLUE panel — wider band with star accents (USA-inspired) ── */}
        <path d="M-10,112 C35,74 70,60 115,58 S180,36 220,16"
              stroke="#1d4ed8" strokeWidth="26" fill="none" opacity=".68"
              strokeLinecap="round" />
        <path d="M-10,112 C35,74 70,60 115,58 S180,36 220,16"
              stroke="#3b82f6" strokeWidth="12" fill="none" opacity=".35"
              strokeLinecap="round" />

        {/* Stars in blue zone */}
        <g fill="#93c5fd" opacity=".6">
          <polygon points="155,32 157.5,39 165,39 159,43.5 161,50.5 155,46 149,50.5 151,43.5 145,39 152.5,39" />
          <polygon points="140,50 141.8,55 147,55 143,57.8 144.5,63 140,60 135.5,63 137,57.8 133,55 138.2,55" />
          <polygon points="170,22 171.5,27 176,27 172.5,29.5 174,34 170,31.5 166,34 167.5,29.5 164,27 168.5,27" />
          <polygon points="125,62 126.5,66 130,66 127,68.2 128.5,72 125,70 121.5,72 123,68.2 120,66 123.5,66" />
        </g>

        {/* ── GREEN panel — flowing band (Mexico-inspired) ── */}
        <path d="M-15,165 C18,128 48,110 92,106 S158,88 215,68"
              stroke="#15803d" strokeWidth="20" fill="none" opacity=".72"
              strokeLinecap="round" />
        <path d="M-15,165 C18,128 48,110 92,106 S158,88 215,68"
              stroke="#22c55e" strokeWidth="9" fill="none" opacity=".35"
              strokeLinecap="round" />

        {/* ── PURPLE / VIOLET accent panel ── */}
        <path d="M-10,188 C15,152 42,135 85,130 S148,112 210,92"
              stroke="#7c3aed" strokeWidth="16" fill="none" opacity=".52"
              strokeLinecap="round" />
        <path d="M-10,188 C15,152 42,135 85,130 S148,112 210,92"
              stroke="#a78bfa" strokeWidth="6" fill="none" opacity=".3"
              strokeLinecap="round" />

        {/* ── COPPER / BROWN panel — top-most band ── */}
        <path d="M-10,88 C40,55 78,44 120,42 S185,24 225,8"
              stroke="#b45309" strokeWidth="14" fill="none" opacity=".5"
              strokeLinecap="round" />
        <path d="M-10,88 C40,55 78,44 120,42 S185,24 225,8"
              stroke="#d97706" strokeWidth="5" fill="none" opacity=".3"
              strokeLinecap="round" />

        {/* ── Thin white accent stripes between panels ── */}
        <g stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" fill="none">
          <path d="M-10,124 C32,86 65,72 108,68 S172,50 215,30" />
          <path d="M-10,150 C22,114 52,98 96,94 S162,76 215,56" />
          <path d="M-10,98 C42,62 76,50 118,48 S182,30 222,12" />
        </g>

        {/* ── "26" with trophy silhouette — centered on the visible face ── */}
        <g opacity=".82">
          {/* Trophy icon — simplified cup shape */}
          <g transform="translate(88,56) scale(0.4)" fill="rgba(255,255,255,0.9)" stroke="rgba(255,255,255,0.5)" strokeWidth="1">
            <path d="M12,0 L28,0 L26,14 C25,20 22,24 20,26 L20,32 L26,34 L26,37 L14,37 L14,34 L20,32 L20,26 C18,24 15,20 14,14 Z" />
            <path d="M10,2 C4,4 2,10 4,15 C5,18 8,18 12,14" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" />
            <path d="M30,2 C36,4 38,10 36,15 C35,18 32,18 28,14" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" />
          </g>
          {/* 26 text */}
          <text x="100" y="106" textAnchor="middle"
                fontFamily="'Barlow Condensed',sans-serif"
                fontSize="46" fontWeight="800" letterSpacing="-2"
                fill="rgba(255,255,255,0.88)"
                stroke="rgba(255,255,255,0.15)" strokeWidth="1">
            26
          </text>
          {/* FIFA text below */}
          <text x="100" y="120" textAnchor="middle"
                fontFamily="'Barlow Condensed',sans-serif"
                fontSize="11" fontWeight="700" letterSpacing="3"
                fill="rgba(255,255,255,0.55)">
            FIFA
          </text>
        </g>

        {/* Subtle adidas-style 3-stripe hint on the left side */}
        <g stroke="rgba(255,255,255,0.2)" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="75" x2="28" y2="110" />
          <line x1="22" y1="73" x2="32" y2="108" />
          <line x1="26" y1="71" x2="36" y2="106" />
        </g>
      </g>

      {/* 3D lighting layers */}
      <circle cx="100" cy="100" r="93" fill={`url(#${id}-floor)`} />
      <circle cx="100" cy="100" r="93" fill={`url(#${id}-spec)`} />
      <circle cx="100" cy="100" r="93" fill={`url(#${id}-rim)`} />

      {/* Outer edge — very subtle dark ring for definition */}
      <circle cx="100" cy="100" r="93" fill="none"
              stroke="rgba(0,0,0,0.08)" strokeWidth="1" />
      {/* Inner highlight ring */}
      <circle cx="100" cy="100" r="91.5" fill="none"
              stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
    </svg>
  );
}
