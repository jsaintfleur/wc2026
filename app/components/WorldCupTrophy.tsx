/**
 * Hyper-realistic FIFA World Cup Trophy SVG.
 *
 * 18-karat polished gold, two spiraling human figures supporting
 * a contoured Earth globe, cylindrical base with malachite bands.
 * Layered over block "2" / "6" characters for 2026 branding.
 * Proportioned at 1:1 real-world ratio (36.8 cm tall).
 */
export default function WorldCupTrophy({
  id = "wct",
  className,
}: {
  id?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 400"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* ── Gold materials ── */}

        {/* Polished 18k gold — main body */}
        <linearGradient id={`${id}-gold`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f5d77a" />
          <stop offset="18%" stopColor="#e8c44a" />
          <stop offset="35%" stopColor="#d4a843" />
          <stop offset="50%" stopColor="#f5d77a" />
          <stop offset="65%" stopColor="#c9952c" />
          <stop offset="82%" stopColor="#e8c44a" />
          <stop offset="100%" stopColor="#d4a843" />
        </linearGradient>

        {/* Gold lit from left (figures left side) */}
        <linearGradient id={`${id}-goldL`} x1="0%" y1="0%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#fae8a0" />
          <stop offset="40%" stopColor="#e8c44a" />
          <stop offset="100%" stopColor="#b8892a" />
        </linearGradient>

        {/* Gold lit from right (figures right side) */}
        <linearGradient id={`${id}-goldR`} x1="100%" y1="0%" x2="0%" y2="50%">
          <stop offset="0%" stopColor="#fae8a0" />
          <stop offset="40%" stopColor="#e8c44a" />
          <stop offset="100%" stopColor="#b8892a" />
        </linearGradient>

        {/* Gold specular highlight */}
        <linearGradient id={`${id}-goldSpec`} x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%" stopColor="#fff8dc" />
          <stop offset="30%" stopColor="#fae8a0" />
          <stop offset="100%" stopColor="#d4a843" />
        </linearGradient>

        {/* Globe gold gradient — sphere shape */}
        <radialGradient id={`${id}-globe`} cx="40%" cy="35%" r="55%">
          <stop offset="0%" stopColor="#fae8a0" />
          <stop offset="40%" stopColor="#e8c44a" />
          <stop offset="75%" stopColor="#c9952c" />
          <stop offset="100%" stopColor="#a07820" />
        </radialGradient>

        {/* Globe specular */}
        <radialGradient id={`${id}-globeSpec`} cx="35%" cy="28%" r="20%">
          <stop offset="0%" stopColor="rgba(255,252,235,0.9)" />
          <stop offset="50%" stopColor="rgba(255,248,220,0.4)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* ── Malachite stone ── */}
        <linearGradient id={`${id}-mal`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1a5c3a" />
          <stop offset="20%" stopColor="#0d4a2c" />
          <stop offset="40%" stopColor="#1e6b42" />
          <stop offset="60%" stopColor="#0b3d24" />
          <stop offset="80%" stopColor="#1a5c3a" />
          <stop offset="100%" stopColor="#0d4a2c" />
        </linearGradient>

        {/* Malachite banding texture */}
        <pattern id={`${id}-malPat`} x="0" y="0" width="12" height="4" patternUnits="userSpaceOnUse">
          <rect width="12" height="4" fill="#14553a" />
          <rect y="1" width="12" height="1.5" fill="#0b3d24" opacity="0.6" />
          <rect y="3" width="12" height="0.5" fill="#1e6b42" opacity="0.4" />
        </pattern>

        {/* ── Block number styling ── */}
        <linearGradient id={`${id}-block`} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#2a2d35" />
          <stop offset="100%" stopColor="#1a1c22" />
        </linearGradient>

        {/* Shadow filter for trophy */}
        <filter id={`${id}-shad`} x="-10%" y="-5%" width="120%" height="115%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
          <feOffset dy="4" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.25" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ════════════════════════════════════════════════════
          BLOCK NUMBERS: "2" stacked on "6" — matte dark
          ════════════════════════════════════════════════════ */}

      {/* "2" — upper block number */}
      <text
        x="120"
        y="195"
        textAnchor="middle"
        fontFamily="'Barlow Condensed', sans-serif"
        fontSize="200"
        fontWeight="900"
        fill={`url(#${id}-block)`}
        opacity="0.12"
        letterSpacing="-8"
      >
        2
      </text>

      {/* "6" — lower block number */}
      <text
        x="120"
        y="390"
        textAnchor="middle"
        fontFamily="'Barlow Condensed', sans-serif"
        fontSize="200"
        fontWeight="900"
        fill={`url(#${id}-block)`}
        opacity="0.12"
        letterSpacing="-8"
      >
        6
      </text>

      {/* ════════════════════════════════════════════════════
          TROPHY — layered over the block numbers
          ════════════════════════════════════════════════════ */}
      <g filter={`url(#${id}-shad)`}>

        {/* ── BASE — cylindrical with malachite bands ── */}

        {/* Base bottom ellipse (3D cylinder effect) */}
        <ellipse cx="120" cy="365" rx="48" ry="8" fill="#8a7530" />

        {/* Base cylinder body */}
        <rect x="72" y="330" width="96" height="35" rx="2" fill={`url(#${id}-gold)`} />

        {/* Base top ellipse */}
        <ellipse cx="120" cy="330" rx="48" ry="8" fill={`url(#${id}-goldSpec)`} />

        {/* Malachite band 1 — lower */}
        <rect x="74" y="350" width="92" height="10" fill={`url(#${id}-mal)`} />
        <rect x="74" y="350" width="92" height="10" fill={`url(#${id}-malPat)`} opacity="0.5" />
        {/* Gold trim lines around malachite */}
        <line x1="74" y1="350" x2="166" y2="350" stroke="#fae8a0" strokeWidth="0.8" />
        <line x1="74" y1="360" x2="166" y2="360" stroke="#c9952c" strokeWidth="0.8" />

        {/* Malachite band 2 — upper */}
        <rect x="74" y="335" width="92" height="10" fill={`url(#${id}-mal)`} />
        <rect x="74" y="335" width="92" height="10" fill={`url(#${id}-malPat)`} opacity="0.5" />
        <line x1="74" y1="335" x2="166" y2="335" stroke="#fae8a0" strokeWidth="0.8" />
        <line x1="74" y1="345" x2="166" y2="345" stroke="#c9952c" strokeWidth="0.8" />

        {/* Base highlight strip */}
        <rect x="95" y="332" width="50" height="2" rx="1" fill="rgba(255,252,235,0.3)" />

        {/* ── STEM — tapers up from base ── */}
        <path
          d="M108,330 L108,295 Q108,288 112,285 L128,285 Q132,288 132,295 L132,330"
          fill={`url(#${id}-gold)`}
        />
        {/* Stem highlight */}
        <path
          d="M115,330 L115,290 L118,286 L118,330"
          fill="rgba(255,252,235,0.2)"
        />

        {/* ── FIGURE LEFT — spiraling human form ── */}
        <g fill={`url(#${id}-goldL)`}>
          {/* Torso — arching left, reaching up */}
          <path
            d="M112,285 C105,270 95,250 88,230
               C82,215 78,195 80,180
               C82,168 88,158 95,152
               L100,150 C95,160 92,172 94,185
               C96,200 102,218 108,235
               C112,248 115,265 116,280 Z"
          />
          {/* Left arm reaching to globe */}
          <path
            d="M95,152 C92,142 90,130 92,120
               C94,110 98,102 104,96
               L108,94 C104,100 100,110 99,120
               C98,128 99,138 100,150 Z"
          />
          {/* Head */}
          <ellipse cx="93" cy="148" rx="5" ry="6" />
          {/* Left hand touching globe */}
          <ellipse cx="105" cy="92" rx="4" ry="3.5" />
        </g>

        {/* ── FIGURE RIGHT — spiraling human form ── */}
        <g fill={`url(#${id}-goldR)`}>
          {/* Torso — arching right, reaching up */}
          <path
            d="M128,285 C135,270 145,250 152,230
               C158,215 162,195 160,180
               C158,168 152,158 145,152
               L140,150 C145,160 148,172 146,185
               C144,200 138,218 132,235
               C128,248 125,265 124,280 Z"
          />
          {/* Right arm reaching to globe */}
          <path
            d="M145,152 C148,142 150,130 148,120
               C146,110 142,102 136,96
               L132,94 C136,100 140,110 141,120
               C142,128 141,138 140,150 Z"
          />
          {/* Head */}
          <ellipse cx="147" cy="148" rx="5" ry="6" />
          {/* Right hand touching globe */}
          <ellipse cx="135" cy="92" rx="4" ry="3.5" />
        </g>

        {/* ── Legs / lower body intertwined ── */}
        <g fill={`url(#${id}-gold)`} opacity="0.9">
          {/* Left figure legs */}
          <path d="M112,285 C110,295 106,310 108,325 L114,325 C114,310 114,295 116,285 Z" />
          {/* Right figure legs */}
          <path d="M128,285 C130,295 134,310 132,325 L126,325 C126,310 126,295 124,285 Z" />
        </g>

        {/* ── GLOBE — Earth contoured sphere ── */}

        {/* Globe main sphere */}
        <circle cx="120" cy="62" r="38" fill={`url(#${id}-globe)`} />

        {/* Continent contours — simplified landmasses etched in gold */}
        <g fill="none" stroke="#a07820" strokeWidth="1" opacity="0.5">
          {/* Americas */}
          <path d="M102,38 C104,42 103,48 100,52 C98,58 100,64 104,68 C106,72 104,78 100,82" />
          <path d="M106,36 C108,40 110,46 108,50 C106,54 108,60 110,64" />
          {/* Europe/Africa */}
          <path d="M128,36 C130,40 132,46 130,52 C128,58 130,66 134,72 C136,78 134,84 130,88" />
          <path d="M134,38 C136,44 138,50 136,56 C134,62 136,68 138,74" />
          {/* Asia outline */}
          <path d="M138,34 C142,38 146,44 148,52 C148,56 146,60 142,64" />
        </g>

        {/* Latitude lines on globe */}
        <g fill="none" stroke="#b8892a" strokeWidth="0.5" opacity="0.3">
          <ellipse cx="120" cy="42" rx="34" ry="4" />
          <ellipse cx="120" cy="52" rx="37" ry="5" />
          <ellipse cx="120" cy="62" rx="38" ry="5" />
          <ellipse cx="120" cy="72" rx="37" ry="5" />
          <ellipse cx="120" cy="82" rx="34" ry="4" />
        </g>

        {/* Meridian lines */}
        <g fill="none" stroke="#b8892a" strokeWidth="0.5" opacity="0.25">
          <ellipse cx="120" cy="62" rx="5" ry="38" />
          <ellipse cx="120" cy="62" rx="20" ry="38" />
          <ellipse cx="120" cy="62" rx="32" ry="38" />
        </g>

        {/* Globe specular highlight */}
        <circle cx="120" cy="62" r="38" fill={`url(#${id}-globeSpec)`} />

        {/* Globe edge ring */}
        <circle
          cx="120"
          cy="62"
          r="38"
          fill="none"
          stroke="#a07820"
          strokeWidth="1"
          opacity="0.4"
        />

        {/* Top of globe — small decorative cap */}
        <ellipse cx="120" cy="24" rx="6" ry="2.5" fill={`url(#${id}-goldSpec)`} opacity="0.8" />

        {/* ── Gold reflections on figures ── */}
        <g opacity="0.3">
          {/* Left figure specular line */}
          <path
            d="M96,175 C98,190 104,215 110,240"
            fill="none"
            stroke="#fff8dc"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {/* Right figure specular line */}
          <path
            d="M144,175 C142,190 136,215 130,240"
            fill="none"
            stroke="#fff8dc"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>

        {/* ── "FIFA" text on base ── */}
        <text
          x="120"
          y="348"
          textAnchor="middle"
          fontFamily="'Barlow Condensed', sans-serif"
          fontSize="5.5"
          fontWeight="700"
          letterSpacing="2.5"
          fill="#0d4a2c"
          opacity="0.7"
        >
          FIFA
        </text>
      </g>
    </svg>
  );
}
