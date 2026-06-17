/*
 * The crumpled paper ball — an irregular silhouette plus shaded facets,
 * folded creases and paper grain. Shared by the flight ball (Crumple) and
 * every ball resting in the bin (BinPhysicsPile).
 */

export const BALL_OUTLINE =
  'M50 9 L62 11 L73 17 L82 27 L88 39 L91 52 L87 64 L80 75 L70 83 L57 89 L44 88 L32 83 L22 74 L16 63 L11 51 L14 38 L20 28 L29 19 L39 12 Z'

const FACET_LIGHT = '38 12 50 9 45 40 35 56 22 74 16 63 11 51 19 28 29 19'
const FACET_LIGHT2 = '50 9 62 11 73 17 62 31 57 46 45 40'
const FACET_SHADOW = '57 46 67 62 70 83 57 89 44 88 50 60'
const FACET_SHADOW2 = '50 60 67 62 57 89 44 88'

const CREASES = [
  'M40 27 L45 40 L50 60 L46 88',
  'M62 30 L57 46 L67 62 L70 83',
  'M45 40 L57 46',
  'M45 40 L35 56 L22 74',
  'M57 46 L67 62',
  'M50 60 L35 56',
  'M50 9 L40 27',
  'M50 9 L62 30',
]

/** White-paper ball matching the note cards: facets, creases, grain. When
 *  `drawn`, the creases are already on (for balls resting in the basket). `lite`
 *  drops the GPU-heavy per-ball filters (feTurbulence grain + the two blur()
 *  overlays) — invisible at pile-ball size, but N of them murders the frame, so
 *  the pile uses lite while the big flight ball keeps the full texture. */
export function PaperBall({ drawn = false, lite = false }: { drawn?: boolean; lite?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <defs>
        <radialGradient id="cr-ballg" cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#f0efeb" />
          <stop offset="100%" stopColor="#d9d8d1" />
        </radialGradient>
        <filter id="cr-ball-sh" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="rgba(20,20,24,0.35)" />
        </filter>
        {/* fine paper grain — a whisper of dark speckle */}
        <filter id="cr-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="6" stitchTiles="stitch" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" />
        </filter>
        <clipPath id="cr-ball-clip">
          <path d={BALL_OUTLINE} />
        </clipPath>
      </defs>
      <g filter="url(#cr-ball-sh)">
        <path d={BALL_OUTLINE} fill="url(#cr-ballg)" stroke="#cfcec8" strokeWidth="0.6" strokeLinejoin="round" />
        <g clipPath="url(#cr-ball-clip)">
          <polygon points={FACET_LIGHT} fill="rgba(255,255,255,0.6)" />
          <polygon points={FACET_LIGHT2} fill="rgba(255,255,255,0.3)" />
          <polygon points={FACET_SHADOW} fill="rgba(96,96,90,0.28)" />
          <polygon points={FACET_SHADOW2} fill="rgba(96,96,90,0.18)" />
          {!lite && (
            <>
              <path
                d="M70 40 C92 52 90 78 74 88 C64 94 48 92 44 86 C66 86 80 64 70 40 Z"
                fill="rgba(78,78,72,0.3)"
                style={{ filter: 'blur(3px)' }}
              />
              <ellipse cx="38" cy="32" rx="16" ry="13" fill="rgba(255,255,255,0.35)" style={{ filter: 'blur(4px)' }} />
              <rect x="0" y="0" width="100" height="100" filter="url(#cr-grain)" opacity="0.28" />
            </>
          )}
        </g>
        <g
          className="cr-creases"
          fill="none"
          stroke="rgba(108,108,100,0.55)"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath="url(#cr-ball-clip)"
        >
          {CREASES.map((d, i) => (
            <path
              key={i}
              className="cr-crease"
              d={d}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={drawn ? 0 : 1}
            />
          ))}
        </g>
        <g fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.7" strokeLinecap="round" clipPath="url(#cr-ball-clip)">
          <path d="M44 39 L34 55" />
          <path d="M58 45 L66 61" />
          <path d="M50 60 L46 86" />
          <path d="M41 28 L46 40" />
        </g>
      </g>
    </svg>
  )
}
