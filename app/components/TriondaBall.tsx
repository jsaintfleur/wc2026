/**
 * Hyper-realistic Adidas Trionda 2026 World Cup match ball.
 *
 * Four-panel seamless geometry with curved seams converging at a
 * central triangle. Three colored wave lanes (Solar Blue, Vibrant Red,
 * Lime Green) with gold metallic trim. Embedded iconography: stars,
 * maple leaf, Aztec eagle head, FIFA 26 logo, Adidas trefoil,
 * "TRIONDA" wordmark. Matte white leather with micro-texture bump.
 */
export default function TriondaBall({
  id = "tb",
  className,
}: {
  id?: string;
  className?: string;
}) {
  const r = 90; // sphere radius
  const cx = 100;
  const cy = 100;

  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* ── Sphere lighting ── */}

        {/* Matte white base — top-left key light */}
        <radialGradient id={`${id}-base`} cx="38%" cy="32%" r="65%">
          <stop offset="0%" stopColor="#fcfcfd" />
          <stop offset="35%" stopColor="#f5f6f8" />
          <stop offset="65%" stopColor="#e8eaef" />
          <stop offset="85%" stopColor="#d2d5dd" />
          <stop offset="100%" stopColor="#b8bcc8" />
        </radialGradient>

        {/* Ambient occlusion ring */}
        <radialGradient id={`${id}-ao`} cx="50%" cy="50%" r="50%">
          <stop offset="72%" stopColor="transparent" />
          <stop offset="90%" stopColor="rgba(0,0,0,0.10)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.20)" />
        </radialGradient>

        {/* Specular highlight — tight, off-center for matte feel */}
        <radialGradient id={`${id}-spec`} cx="32%" cy="24%" r="16%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Diffuse fill light */}
        <radialGradient id={`${id}-diff`} cx="40%" cy="36%" r="42%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Bottom shadow */}
        <radialGradient id={`${id}-btm`} cx="50%" cy="94%" r="42%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.15)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Ground contact shadow */}
        <radialGradient id={`${id}-gnd`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.28)" />
          <stop offset="60%" stopColor="rgba(0,0,0,0.06)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Gold metallic gradient for trim */}
        <linearGradient id={`${id}-gold`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4a843" />
          <stop offset="25%" stopColor="#f5d77a" />
          <stop offset="50%" stopColor="#e8c44a" />
          <stop offset="75%" stopColor="#f5d77a" />
          <stop offset="100%" stopColor="#c9952c" />
        </linearGradient>

        {/* Gold shimmer for highlight edge */}
        <linearGradient id={`${id}-goldhi`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f9e99f" />
          <stop offset="50%" stopColor="#fff8dc" />
          <stop offset="100%" stopColor="#e8c44a" />
        </linearGradient>

        {/* Micro-texture — subtle leather grain + star/leaf bump */}
        <filter id={`${id}-tex`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="2.2"
            numOctaves="5"
            seed="42"
            result="noise"
          />
          <feColorMatrix
            type="saturate"
            values="0"
            in="noise"
            result="grey"
          />
          <feBlend
            in="SourceGraphic"
            in2="grey"
            mode="multiply"
            result="textured"
          />
          <feComponentTransfer in="textured">
            <feFuncA type="linear" slope="0.06" />
          </feComponentTransfer>
        </filter>

        {/* Seam depth shadow */}
        <filter id={`${id}-seam`} x="-4%" y="-4%" width="108%" height="108%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.8" result="blur" />
          <feOffset dx="0.4" dy="0.6" result="off" />
          <feComposite in="off" in2="SourceAlpha" operator="out" result="shadow" />
          <feFlood floodColor="rgba(0,0,0,0.4)" result="color" />
          <feComposite in="color" in2="shadow" operator="in" result="groove" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="groove" />
          </feMerge>
        </filter>

        <clipPath id={`${id}-clip`}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>

        {/* Maple leaf symbol (simplified) */}
        <symbol id={`${id}-maple`} viewBox="0 0 20 24">
          <path
            d="M10,0 L11.5,5 L15,4 L13,8 L17,8 L14,11 L16,14 L12,13
               L12,16 L10,14 L8,16 L8,13 L4,14 L6,11 L3,8 L7,8 L5,4
               L8.5,5 Z M9.5,16 L10.5,16 L10.5,23 L9.5,23 Z"
            fill="currentColor"
          />
        </symbol>

        {/* Star symbol */}
        <symbol id={`${id}-star`} viewBox="0 0 12 12">
          <polygon
            points="6,0 7.5,4 12,4.5 8.5,7.5 9.5,12 6,9.5 2.5,12 3.5,7.5 0,4.5 4.5,4"
            fill="currentColor"
          />
        </symbol>

        {/* Aztec eagle head (simplified profile) */}
        <symbol id={`${id}-eagle`} viewBox="0 0 24 20">
          <path
            d="M0,14 C2,12 4,10 6,10 C7,10 8,9 9,8 C10,6 12,4 14,3
               C16,2 18,2 20,3 L24,1 L22,4 C23,5 24,7 23,9
               C22,11 20,12 18,12 L16,12 C14,13 12,14 10,16
               C8,18 6,19 4,19 C2,19 1,18 0,16 Z
               M19,6 C19.5,6 20,6.5 20,7 C20,7.5 19.5,8 19,8
               C18.5,8 18,7.5 18,7 C18,6.5 18.5,6 19,6 Z"
            fill="currentColor"
          />
        </symbol>

        {/* Adidas three stripes */}
        <symbol id={`${id}-adi`} viewBox="0 0 16 14">
          <rect x="0" y="0" width="3.5" height="14" rx="0.5" fill="currentColor" />
          <rect x="5" y="3" width="3.5" height="11" rx="0.5" fill="currentColor" />
          <rect x="10" y="6" width="3.5" height="8" rx="0.5" fill="currentColor" />
        </symbol>
      </defs>

      {/* Ground shadow ellipse */}
      <ellipse cx={cx} cy="195" rx="52" ry="5" fill={`url(#${id}-gnd)`} />

      {/* ── Base sphere ── */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-base)`} />

      {/* Leather micro-texture */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="white"
        filter={`url(#${id}-tex)`}
        clipPath={`url(#${id}-clip)`}
      />

      {/* ── Panel content (clipped to sphere) ── */}
      <g clipPath={`url(#${id}-clip)`}>

        {/* ════════════════════════════════════════════════
            PANEL SEAMS — four-panel geometry converging
            at a central triangle. Deep curved seams.
            ════════════════════════════════════════════════ */}

        {/* Central triangle convergence point ~(105, 82) */}

        {/* ════════════════════════════════════════════════
            WAVE LANE 1: SOLAR BLUE
            Upper-left flowing across to center-right.
            Contains star iconography + FIFA 26 lockup.
            ════════════════════════════════════════════════ */}

        {/* Blue wave — main body */}
        <path
          d="M-5,105 C15,78 40,62 72,54 C95,48 120,40 148,28
             C158,24 170,18 185,10
             L190,22 C175,32 162,38 150,44
             C122,56 96,64 72,72 C42,82 18,98 -5,125 Z"
          fill="#0077c8"
          opacity="0.88"
        />
        {/* Blue wave — lighter inner highlight for depth */}
        <path
          d="M0,100 C18,76 42,60 75,52 C100,46 126,36 155,22
             L158,28 C128,42 102,50 78,56 C46,64 22,78 2,100 Z"
          fill="#2ea0e6"
          opacity="0.55"
        />
        {/* Blue wave — dark edge for volume */}
        <path
          d="M-5,108 C14,82 38,66 68,58 C92,52 118,42 146,30
             L148,28 C120,40 94,48 70,54 C38,62 14,78 -5,105 Z"
          fill="#004f8c"
          opacity="0.35"
        />

        {/* Stars scattered in blue lane */}
        <g color="#a8d8ff" opacity="0.8">
          <use href={`#${id}-star`} x="52" y="58" width="7" height="7" />
          <use href={`#${id}-star`} x="72" y="50" width="6" height="6" />
          <use href={`#${id}-star`} x="95" y="42" width="7" height="7" />
          <use href={`#${id}-star`} x="115" y="36" width="5.5" height="5.5" />
          <use href={`#${id}-star`} x="135" y="28" width="6" height="6" />
          <use href={`#${id}-star`} x="40" y="68" width="5" height="5" />
          <use href={`#${id}-star`} x="82" y="46" width="4.5" height="4.5" />
          <use href={`#${id}-star`} x="60" y="64" width="4" height="4" />
          <use href={`#${id}-star`} x="148" y="24" width="5" height="5" />
        </g>

        {/* "FIFA 26" lockup in blue lane */}
        <text
          x="100"
          y="55"
          textAnchor="middle"
          fontFamily="'Barlow Condensed',sans-serif"
          fontSize="7.5"
          fontWeight="700"
          letterSpacing="1.5"
          fill="rgba(255,255,255,0.85)"
          transform="rotate(-18, 100, 55)"
        >
          FIFA
        </text>
        <text
          x="124"
          y="50"
          textAnchor="middle"
          fontFamily="'Barlow Condensed',sans-serif"
          fontSize="10"
          fontWeight="800"
          fill="rgba(255,255,255,0.9)"
          transform="rotate(-18, 124, 50)"
        >
          26
        </text>

        {/* Gold trim — upper edge of blue wave */}
        <path
          d="M-2,102 C16,76 40,60 72,52 C98,46 124,36 152,22"
          fill="none"
          stroke={`url(#${id}-gold)`}
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.9"
        />
        {/* Gold trim — lower edge of blue wave */}
        <path
          d="M-5,126 C18,100 44,84 74,74 C100,66 126,56 155,44"
          fill="none"
          stroke={`url(#${id}-gold)`}
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.85"
        />
        {/* Gold highlight shimmer on upper trim */}
        <path
          d="M-2,101 C16,75 40,59 72,51 C98,45 124,35 152,21"
          fill="none"
          stroke={`url(#${id}-goldhi)`}
          strokeWidth="0.6"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* ════════════════════════════════════════════════
            WAVE LANE 2: VIBRANT RED
            Center band flowing left-to-right.
            Contains maple leaf + Adidas logo.
            ════════════════════════════════════════════════ */}

        {/* Red wave — main body */}
        <path
          d="M-8,148 C12,118 38,100 68,90 C95,82 122,72 152,58
             C162,53 175,46 190,38
             L194,50 C178,60 164,66 152,72
             C124,84 98,94 70,104 C40,114 14,134 -8,162 Z"
          fill="#e4002b"
          opacity="0.85"
        />
        {/* Red wave — inner glow */}
        <path
          d="M-2,142 C16,114 40,98 70,88 C98,80 126,68 156,54
             L160,60 C130,74 102,84 74,92 C44,102 20,120 0,146 Z"
          fill="#ff3355"
          opacity="0.45"
        />
        {/* Red wave — dark underside */}
        <path
          d="M-8,152 C10,122 36,104 66,94 C92,86 120,76 150,62
             L152,58 C122,72 94,82 66,90 C36,100 12,118 -8,148 Z"
          fill="#a00020"
          opacity="0.3"
        />

        {/* Maple leaf in red lane */}
        <g color="rgba(255,210,210,0.75)" opacity="0.85">
          <use
            href={`#${id}-maple`}
            x="60"
            y="88"
            width="14"
            height="17"
            transform="rotate(-15, 67, 97)"
          />
          <use
            href={`#${id}-maple`}
            x="108"
            y="70"
            width="10"
            height="12"
            transform="rotate(-20, 113, 76)"
          />
        </g>

        {/* Adidas three stripes in red lane */}
        <g
          color="rgba(255,230,230,0.7)"
          transform="translate(138, 60) rotate(-22) scale(0.7)"
        >
          <use href={`#${id}-adi`} x="0" y="0" width="16" height="14" />
        </g>

        {/* Gold trim — upper edge of red wave */}
        <path
          d="M-6,146 C12,116 38,98 68,88 C96,80 124,68 154,54"
          fill="none"
          stroke={`url(#${id}-gold)`}
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.9"
        />
        {/* Gold trim — lower edge of red wave */}
        <path
          d="M-8,164 C14,136 42,118 72,106 C100,96 128,86 158,72"
          fill="none"
          stroke={`url(#${id}-gold)`}
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M-6,145 C12,115 38,97 68,87 C96,79 124,67 154,53"
          fill="none"
          stroke={`url(#${id}-goldhi)`}
          strokeWidth="0.6"
          strokeLinecap="round"
          opacity="0.55"
        />

        {/* ════════════════════════════════════════════════
            WAVE LANE 3: LIME GREEN
            Lower band. Contains Aztec eagle + "TRIONDA".
            ════════════════════════════════════════════════ */}

        {/* Green wave — main body */}
        <path
          d="M-10,188 C8,156 34,136 64,126 C90,118 118,106 148,92
             C160,86 174,78 190,68
             L194,80 C178,90 164,98 150,104
             C120,118 92,130 64,140 C36,150 12,170 -10,200 Z"
          fill="#78be20"
          opacity="0.82"
        />
        {/* Green wave — lighter core */}
        <path
          d="M-4,182 C14,152 38,134 68,124 C96,116 124,104 154,88
             L158,94 C128,110 100,120 72,128 C42,138 18,158 -2,186 Z"
          fill="#a0e040"
          opacity="0.4"
        />
        {/* Green wave — dark edge */}
        <path
          d="M-10,192 C6,160 32,140 62,130 C88,122 116,110 146,96
             L148,92 C118,106 90,118 62,126 C32,136 8,156 -10,188 Z"
          fill="#4a8a10"
          opacity="0.3"
        />

        {/* Aztec eagle head in green lane */}
        <g color="rgba(220,255,200,0.75)" opacity="0.8">
          <use
            href={`#${id}-eagle`}
            x="55"
            y="125"
            width="20"
            height="16"
            transform="rotate(-14, 65, 133)"
          />
          <use
            href={`#${id}-eagle`}
            x="108"
            y="102"
            width="14"
            height="11"
            transform="rotate(-20, 115, 108)"
          />
        </g>

        {/* "TRIONDA" wordmark in green lane */}
        <text
          x="92"
          y="140"
          textAnchor="middle"
          fontFamily="'Barlow Condensed',sans-serif"
          fontSize="7"
          fontWeight="700"
          letterSpacing="3"
          fill="rgba(255,255,255,0.82)"
          transform="rotate(-16, 92, 140)"
        >
          TRIONDA
        </text>

        {/* Gold trim — upper edge of green wave */}
        <path
          d="M-8,186 C8,154 34,134 64,124 C92,116 120,104 150,90"
          fill="none"
          stroke={`url(#${id}-gold)`}
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.9"
        />
        {/* Gold trim — lower edge of green wave */}
        <path
          d="M-10,204 C12,172 40,154 70,142 C98,132 128,120 160,106"
          fill="none"
          stroke={`url(#${id}-gold)`}
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M-8,185 C8,153 34,133 64,123 C92,115 120,103 150,89"
          fill="none"
          stroke={`url(#${id}-goldhi)`}
          strokeWidth="0.6"
          strokeLinecap="round"
          opacity="0.55"
        />

        {/* ════════════════════════════════════════════════
            FOUR-PANEL SEAMS
            Deep curved seams converging at central triangle
            near (105, 82). Filter gives inset groove depth.
            ════════════════════════════════════════════════ */}
        <g filter={`url(#${id}-seam)`}>
          {/* Seam A — top-left to center triangle */}
          <path
            d="M18,12 C35,35 55,52 80,65 C90,70 98,76 105,82"
            fill="none"
            stroke="rgba(40,40,50,0.45)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          {/* Seam B — top-right to center triangle */}
          <path
            d="M192,18 C170,38 148,52 125,66 C115,72 108,78 105,82"
            fill="none"
            stroke="rgba(40,40,50,0.45)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          {/* Seam C — bottom to center triangle */}
          <path
            d="M100,198 C102,170 104,148 105,128 C105,110 105,95 105,82"
            fill="none"
            stroke="rgba(40,40,50,0.45)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          {/* Seam D — left edge, curves around */}
          <path
            d="M18,12 C10,40 8,70 10,100 C12,130 20,160 40,185 C60,198 80,200 100,198"
            fill="none"
            stroke="rgba(40,40,50,0.35)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {/* Seam E — right edge, curves around */}
          <path
            d="M192,18 C196,48 196,78 190,108 C182,140 168,168 145,188 C125,198 112,200 100,198"
            fill="none"
            stroke="rgba(40,40,50,0.35)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {/* Central triangle outline */}
          <path
            d="M98,74 L112,74 L105,86 Z"
            fill="none"
            stroke="rgba(40,40,50,0.5)"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </g>

        {/* Stitch dots along seams */}
        <g fill="none" stroke="rgba(60,60,70,0.2)" strokeWidth="0.5"
           strokeDasharray="1.2 2.8" strokeLinecap="round">
          <path d="M20,14 C36,36 56,53 80,66 L105,82" />
          <path d="M190,20 C168,40 147,53 124,67 L105,82" />
          <path d="M100,196 C102,168 104,146 105,126 L105,82" />
        </g>

        {/* Micro-texture repeating pattern overlay — stars, leaves, eagles */}
        <g opacity="0.04" clipPath={`url(#${id}-clip)`}>
          {[0, 1, 2, 3, 4].map(row =>
            [0, 1, 2, 3, 4, 5].map(col => {
              const xp = col * 38 - 5;
              const yp = row * 42 + 5;
              const sym = (row + col) % 3;
              return (
                <g key={`${row}-${col}`} color="#333">
                  {sym === 0 && (
                    <use href={`#${id}-star`} x={xp} y={yp} width="10" height="10" />
                  )}
                  {sym === 1 && (
                    <use href={`#${id}-maple`} x={xp} y={yp} width="9" height="11" />
                  )}
                  {sym === 2 && (
                    <use href={`#${id}-eagle`} x={xp} y={yp} width="12" height="9" />
                  )}
                </g>
              );
            })
          )}
        </g>
      </g>

      {/* ── 3D Lighting stack ── */}

      {/* Ambient occlusion */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-ao)`} />

      {/* Bottom crescent shadow */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-btm)`} />

      {/* Diffuse fill */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-diff)`} />

      {/* Specular highlight */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-spec)`} />

      {/* Sphere edge definition */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgba(0,0,0,0.08)"
        strokeWidth="0.7"
      />

      {/* Rim light — top-left arc */}
      <path
        d="M28,52 A90,90 0 0,1 65,16"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Secondary rim — bottom-right, faint kick light */}
      <path
        d="M160,168 A90,90 0 0,1 182,132"
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
