/**
 * 3D soccer ball SVG with Trionda-inspired color panels.
 * Built as a proper sphere with curved filled panels, stitching seams,
 * realistic lighting (specular, ambient occlusion, rim light), and
 * ground shadow. Each instance uses unique gradient IDs.
 */
export default function TriondaBall({ id = "tb", className }: { id?: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Sphere base — lit from top-left */}
        <radialGradient id={`${id}-base`} cx="40%" cy="35%" r="62%">
          <stop offset="0%" stopColor="#fafafa" />
          <stop offset="50%" stopColor="#eeeff2" />
          <stop offset="80%" stopColor="#d0d3da" />
          <stop offset="100%" stopColor="#a8adb8" />
        </radialGradient>

        {/* Edge darkening — ambient occlusion ring */}
        <radialGradient id={`${id}-ao`} cx="50%" cy="50%" r="50%">
          <stop offset="70%" stopColor="transparent" />
          <stop offset="92%" stopColor="rgba(0,0,0,0.12)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.22)" />
        </radialGradient>

        {/* Specular highlight — tight bright spot */}
        <radialGradient id={`${id}-spec`} cx="34%" cy="26%" r="18%">
          <stop offset="0%" stopColor="rgba(255,255,255,1)" />
          <stop offset="40%" stopColor="rgba(255,255,255,0.6)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Secondary diffuse highlight */}
        <radialGradient id={`${id}-diff`} cx="42%" cy="38%" r="40%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Bottom shadow on sphere */}
        <radialGradient id={`${id}-btm`} cx="50%" cy="92%" r="45%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.18)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Ground shadow */}
        <radialGradient id={`${id}-gnd`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.30)" />
          <stop offset="65%" stopColor="rgba(0,0,0,0.06)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>

        {/* Seam groove filter — inset shadow effect */}
        <filter id={`${id}-groove`} x="-2%" y="-2%" width="104%" height="104%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="blur" />
          <feOffset dx="0.3" dy="0.5" result="off" />
          <feComposite in="off" in2="SourceAlpha" operator="out" result="shadow" />
          <feFlood floodColor="rgba(0,0,0,0.35)" result="color" />
          <feComposite in="color" in2="shadow" operator="in" result="groove" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="groove" />
          </feMerge>
        </filter>

        {/* Texture noise for leather feel */}
        <filter id={`${id}-tex`}>
          <feTurbulence type="fractalNoise" baseFrequency="1.8" numOctaves="4" result="noise" />
          <feColorMatrix type="saturate" values="0" in="noise" result="grey" />
          <feBlend in="SourceGraphic" in2="grey" mode="multiply" result="textured" />
          <feComponentTransfer in="textured">
            <feFuncA type="linear" slope="0.08" />
          </feComponentTransfer>
        </filter>

        <clipPath id={`${id}-clip`}><circle cx="100" cy="100" r="92" /></clipPath>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="100" cy="194" rx="54" ry="5" fill={`url(#${id}-gnd)`} />

      {/* Base white sphere */}
      <circle cx="100" cy="100" r="92" fill={`url(#${id}-base)`} />

      {/* Leather texture overlay */}
      <circle cx="100" cy="100" r="92" fill="white" filter={`url(#${id}-tex)`} clipPath={`url(#${id}-clip)`} />

      {/* ── Color panels — filled shapes that curve with the sphere ── */}
      <g clipPath={`url(#${id}-clip)`}>

        {/* Panel 1: RED — large swooping shape, left-center to top-right */}
        <path d="M-5,155 C20,120 50,98 85,88 C110,80 140,68 165,52 C175,46 190,36 200,28
                 L200,48 C185,58 170,68 155,76 C130,90 100,102 75,112 C50,122 20,142 -5,170 Z"
              fill="#dc2626" opacity=".82" />
        <path d="M-5,150 C22,116 52,95 88,85 C115,77 145,64 170,48
                 L170,52 C145,68 115,80 88,88 C52,98 22,120 -5,155 Z"
              fill="#ef4444" opacity=".5" />

        {/* Panel 2: BLUE — wide band with depth, upper-center */}
        <path d="M10,118 C35,82 68,64 108,56 C138,50 168,38 195,20
                 L195,38 C170,52 140,62 112,68 C75,78 42,94 15,128 Z"
              fill="#1e40af" opacity=".78" />
        <path d="M15,108 C40,76 72,60 110,52 C140,46 170,34 198,16
                 L198,22 C170,38 140,50 112,56 C74,64 42,80 18,112 Z"
              fill="#3b82f6" opacity=".45" />

        {/* Stars in the blue panel */}
        <g fill="#bfdbfe" opacity=".7">
          <polygon points="148,38 150,43 155,43 151,46 152.5,51 148,48 143.5,51 145,46 141,43 146,43" />
          <polygon points="132,52 133.5,56 137,56 134,58.5 135.5,62 132,59.5 128.5,62 130,58.5 127,56 130.5,56" />
          <polygon points="165,28 166.5,32 170,32 167,34.2 168,38 165,35.5 162,38 163,34.2 160,32 163.5,32" />
          <polygon points="118,62 119.2,65 122,65 120,67 121,70 118,68 115,70 116,67 114,65 116.8,65" />
          <polygon points="152,52 153,55 156,55 153.5,57 154.5,60 152,58 149.5,60 150.5,57 148,55 151,55" />
        </g>

        {/* Panel 3: GREEN — bottom-left swooping shape */}
        <path d="M-10,185 C12,148 40,128 78,118 C108,110 138,98 168,80
                 L168,96 C140,112 112,122 82,130 C48,142 18,162 -10,198 Z"
              fill="#15803d" opacity=".75" />
        <path d="M-8,180 C15,145 42,126 80,116 C110,108 142,95 172,76
                 L172,82 C142,98 112,110 82,118 C44,128 16,148 -8,185 Z"
              fill="#22c55e" opacity=".4" />

        {/* Panel 4: PURPLE — accent panel lower area */}
        <path d="M30,200 C40,172 58,155 85,145 C112,136 140,122 165,105
                 L165,116 C142,132 115,144 90,152 C65,162 45,178 35,200 Z"
              fill="#7c3aed" opacity=".6" />

        {/* Panel 5: COPPER — top band */}
        <path d="M25,92 C50,62 82,48 118,42 C148,37 178,26 205,10
                 L205,22 C180,34 152,44 124,50 C88,58 56,72 30,100 Z"
              fill="#b45309" opacity=".55" />
        <path d="M30,86 C54,58 84,45 120,40 C150,35 180,24 208,8
                 L208,14 C180,28 152,38 124,44 C86,52 56,66 32,92 Z"
              fill="#d97706" opacity=".35" />

        {/* White accent stripes between panels — like Trionda flowing lines */}
        <g stroke="rgba(255,255,255,0.5)" strokeWidth="1.8" fill="none" strokeLinecap="round">
          <path d="M5,136 C28,100 58,82 96,74 C126,67 156,54 185,36" />
          <path d="M-2,168 C18,132 46,114 84,104 C114,96 144,82 174,64" />
          <path d="M18,102 C42,70 74,55 114,48 C144,42 174,30 202,14" />
        </g>

        {/* ── Stitching seams — dotted lines for realism ── */}
        <g stroke="rgba(80,80,80,0.25)" strokeWidth="0.8" fill="none"
           strokeDasharray="2.5 2" strokeLinecap="round">
          <path d="M8,140 C30,104 60,86 98,78 C128,71 158,58 188,40" />
          <path d="M-5,172 C16,136 44,118 82,108 C112,100 142,86 172,68" />
          <path d="M22,106 C44,74 76,59 116,52 C146,46 176,34 204,18" />
          <path d="M35,200 C42,174 60,158 88,148 C116,138 144,124 170,108" />
          <path d="M28,96 C52,66 84,50 122,44 C152,38 182,28 210,12" />
        </g>

        {/* ── "26" branding — subtle embossed look ── */}
        <g opacity=".72">
          {/* Trophy silhouette */}
          <g transform="translate(90,58) scale(0.35)" fill="rgba(255,255,255,0.75)">
            <path d="M12,0 L28,0 L26,12 C25,18 22,22 20,24 L20,30 L25,32 L25,35 L15,35 L15,32 L20,30 L20,24 C18,22 15,18 14,12 Z" />
            <path d="M11,1 C6,3 4,8 5,13 C6,15 8,16 11,13" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
            <path d="M29,1 C34,3 36,8 35,13 C34,15 32,16 29,13" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
          </g>
          {/* "26" number */}
          <text x="100" y="104" textAnchor="middle"
                fontFamily="'Barlow Condensed',sans-serif"
                fontSize="42" fontWeight="800" letterSpacing="-1.5"
                fill="rgba(255,255,255,0.8)"
                stroke="rgba(200,200,210,0.3)" strokeWidth="0.5">
            26
          </text>
        </g>
      </g>

      {/* ── 3D Lighting stack ── */}

      {/* Ambient occlusion — darkens edges for roundness */}
      <circle cx="100" cy="100" r="92" fill={`url(#${id}-ao)`} />

      {/* Bottom shadow crescent */}
      <circle cx="100" cy="100" r="92" fill={`url(#${id}-btm)`} />

      {/* Diffuse highlight */}
      <circle cx="100" cy="100" r="92" fill={`url(#${id}-diff)`} />

      {/* Specular highlight — bright spot */}
      <circle cx="100" cy="100" r="92" fill={`url(#${id}-spec)`} />

      {/* Outer edge ring — subtle dark border for definition */}
      <circle cx="100" cy="100" r="92" fill="none"
              stroke="rgba(0,0,0,0.1)" strokeWidth="0.8" />

      {/* Top-left rim highlight */}
      <path d="M30,55 A92,92 0 0,1 68,18" fill="none"
            stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
