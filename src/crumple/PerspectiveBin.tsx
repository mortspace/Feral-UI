/*
 * Wire-mesh wastepaper basket (viewBox 0 0 200 300): a tapered metal bin — a
 * polished rim collar, a SEE-THROUGH diamond mesh body (the page shows through
 * the gaps), and a polished steel band at the foot.
 *
 * Two layers sandwich the ball pile. BACK: a faint themed interior tint (so the
 * paper seats against it without hiding the page), the dim FAR mesh wall, and
 * the floor. FRONT: the bright NEAR mesh wall + cylinder edge-shading + the rim
 * collar + the foot band — drawn over the pile so the paper reads as INSIDE,
 * seen through the mesh.
 *
 * Colours come from CSS custom properties on .crumple so the basket relights
 * for the light and dark page themes. BIN_ART is the single source of truth:
 * the drawn mouth/floor ellipses are exactly the physics geometry.
 */

export const BIN_ART = {
  w: 200,
  h: 300,
  /** Mouth centre — fraction from the top of the bin box (the opening). */
  mouthY: 42 / 300,
  /** Floor centre — fraction from the top; balls rest on this elliptical floor.
   *  Sits inside the mesh (above the foot band) so the heap reads through the
   *  wire, tucking only slightly behind the band at its front edge. */
  floorY: 220 / 300,
  mouth: { cx: 100, cy: 42, rx: 72, ry: 16 },
  floor: { cx: 100, cy: 220, rx: 60, ry: 13 },
} as const

/** Interior clip for the pile stage — the tapered mesh cavity. Bottom runs low
 *  so the front (lower-on-screen) balls of the 3D heap aren't sliced. */
export const BIN_INTERIOR_CLIP = 'polygon(15% 13%, 85% 13%, 81% 86%, 19% 86%)'

// frustum the whole basket is built on (cx = 100 throughout)
const RIM_T = { cy: 30, rx: 80, ry: 20 } // bright top edge of the rim lip
const RIM_B = { cy: 56, rx: 78, ry: 18 } // rim-lip bottom / mesh top (slim rim)
const MESH_B = { cy: 234, rx: 62, ry: 13 } // mesh bottom / foot-band top
const BASE_B = { cy: 258, rx: 59, ry: 12 } // foot bottom

// front faces of each tube segment, left→down→base-arc→up→top-arc
const collarFace = `M ${100 - RIM_T.rx} ${RIM_T.cy} L ${100 - RIM_B.rx} ${RIM_B.cy} A ${RIM_B.rx} ${RIM_B.ry} 0 0 0 ${100 + RIM_B.rx} ${RIM_B.cy} L ${100 + RIM_T.rx} ${RIM_T.cy} A ${RIM_T.rx} ${RIM_T.ry} 0 0 1 ${100 - RIM_T.rx} ${RIM_T.cy} Z`
const meshFace = `M ${100 - RIM_B.rx} ${RIM_B.cy} L ${100 - MESH_B.rx} ${MESH_B.cy} A ${MESH_B.rx} ${MESH_B.ry} 0 0 0 ${100 + MESH_B.rx} ${MESH_B.cy} L ${100 + RIM_B.rx} ${RIM_B.cy} A ${RIM_B.rx} ${RIM_B.ry} 0 0 1 ${100 - RIM_B.rx} ${RIM_B.cy} Z`
const baseFace = `M ${100 - MESH_B.rx} ${MESH_B.cy} L ${100 - BASE_B.rx} ${BASE_B.cy} A ${BASE_B.rx} ${BASE_B.ry} 0 0 0 ${100 + BASE_B.rx} ${BASE_B.cy} L ${100 + MESH_B.rx} ${MESH_B.cy} A ${MESH_B.rx} ${MESH_B.ry} 0 0 1 ${100 - MESH_B.rx} ${MESH_B.cy} Z`

// far inner-lip arc of the mouth (the lit back edge seen above the collar)
const mouthFar = `M ${100 - BIN_ART.mouth.rx} ${BIN_ART.mouth.cy} A ${BIN_ART.mouth.rx} ${BIN_ART.mouth.ry} 0 0 1 ${100 + BIN_ART.mouth.rx} ${BIN_ART.mouth.cy}`

// a catch-light along the TOP of the rim — a true arc of the rim ellipse, so
// its endpoints sit exactly on the ring and it never diverges into a double line
const RIM_HL = (() => {
  const off = 60
  const y = (RIM_T.cy - RIM_T.ry * Math.sqrt(1 - (off / RIM_T.rx) ** 2)).toFixed(2)
  return `M ${100 - off} ${y} A ${RIM_T.rx} ${RIM_T.ry} 0 0 1 ${100 + off} ${y}`
})()

/** Back half: faint interior tint + far mesh wall + the floor disc. */
export function PerspectiveBinBack() {
  return (
    <svg className="cr-bin-layer cr-bin-back" viewBox="0 0 200 300" aria-hidden="true">
      <defs>
        {/* far wall of the mesh, seen through the front — dim, half-cell offset */}
        <pattern id="cr-mesh-back" width="12" height="17" patternUnits="userSpaceOnUse" patternTransform="translate(6 0)">
          <path d="M0 0 L12 17 M12 0 L0 17" style={{ stroke: 'var(--cr-mesh-back)' }} strokeWidth="0.6" fill="none" />
        </pattern>
        {/* the shaded interior — lit near the opening, deepening into shadow at
            the floor. A translucent wash (not a flat tint) so the basket reads
            as a real vessel in both themes, and the depths never look see-through. */}
        <linearGradient id="cr-cavity-grad" gradientUnits="userSpaceOnUse" x1="100" y1="30" x2="100" y2="222">
          <stop offset="0%" style={{ stopColor: 'var(--cr-cavity-top)' }} />
          <stop offset="62%" style={{ stopColor: 'var(--cr-cavity-mid)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--cr-cavity-bot)' }} />
        </linearGradient>
      </defs>

      {/* (the ground contact shadow lives in CSS .cr-bin-shadow so it stays on
          the floor instead of riding up with the basket) */}

      {/* the mouth — a see-through shaft, not a black hole: a faint tint, a hint
          of the far mesh down the throat, and a lit far rim */}
      <ellipse cx="100" cy={BIN_ART.mouth.cy} rx={BIN_ART.mouth.rx} ry={BIN_ART.mouth.ry} fill="url(#cr-cavity-grad)" />
      <ellipse cx="100" cy={BIN_ART.mouth.cy} rx={BIN_ART.mouth.rx} ry={BIN_ART.mouth.ry} fill="url(#cr-mesh-back)" opacity="0.3" />
      <path d={mouthFar} fill="none" style={{ stroke: 'var(--cr-mesh-front)' }} strokeOpacity="0.4" strokeWidth="1" />

      {/* shaded interior behind the body so paper seats against it, then the far
          mesh wall over it (the wires still read, the depths read as inside) */}
      <path d={meshFace} fill="url(#cr-cavity-grad)" />
      <path d={meshFace} fill="url(#cr-mesh-back)" style={{ opacity: 'var(--cr-mesh-back-op)' }} />

      {/* the floor the balls land on — translucent disc with a faint seat ring */}
      <ellipse cx="100" cy="220" rx="60" ry="13" style={{ fill: 'var(--cr-floor)' }} />
      <ellipse cx="100" cy="218" rx="47" ry="9" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
    </svg>
  )
}

/** Front half: near mesh + cylinder shade + rim collar + foot band. */
export function PerspectiveBinFront() {
  return (
    <svg className="cr-bin-layer cr-bin-front" viewBox="0 0 200 300" aria-hidden="true">
      <defs>
        {/* near mesh wall — bright steel diamonds, over the pile */}
        <pattern id="cr-mesh-front" width="12" height="17" patternUnits="userSpaceOnUse">
          <path d="M0 0 L12 17 M12 0 L0 17" style={{ stroke: 'var(--cr-mesh-front)' }} strokeWidth="0.75" fill="none" />
        </pattern>
        {/* the rounded wall falls into shadow at the edges, lit through the middle */}
        <linearGradient id="cr-mesh-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: 'var(--cr-edge-shade)' }} />
          <stop offset="18%" stopColor="rgba(0,0,0,0)" />
          <stop offset="50%" style={{ stopColor: 'var(--cr-edge-light)' }} />
          <stop offset="82%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" style={{ stopColor: 'var(--cr-edge-shade)' }} />
        </linearGradient>
        {/* polished-steel band: two broad soft sheens over a darker belly, lit
            edges — smooth chrome, no hard streaks */}
        <linearGradient id="cr-steel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#edf0f3" />
          <stop offset="16%" stopColor="#b6bbc3" />
          <stop offset="32%" stopColor="#eef1f5" />
          <stop offset="48%" stopColor="#9398a1" />
          <stop offset="61%" stopColor="#c6cbd2" />
          <stop offset="77%" stopColor="#868b95" />
          <stop offset="90%" stopColor="#cfd3d9" />
          <stop offset="100%" stopColor="#edeff3" />
        </linearGradient>
        <linearGradient id="cr-rim-top" x1="0" y1="0" x2="1" y2="0.25">
          <stop offset="0%" stopColor="#fbfcfd" />
          <stop offset="30%" stopColor="#caced4" />
          <stop offset="55%" stopColor="#aab0b9" />
          <stop offset="100%" stopColor="#e6e9ed" />
        </linearGradient>
        {/* fine vertical brushing for the metal bands */}
        <pattern id="cr-brush" width="2.4" height="6" patternUnits="userSpaceOnUse">
          <path d="M0.6 0 V6 M1.8 0 V6" stroke="rgba(255,255,255,0.05)" strokeWidth="0.4" />
        </pattern>
      </defs>

      {/* near mesh wall over the pile (paper shows through the diamonds) */}
      <path d={meshFace} fill="url(#cr-mesh-front)" style={{ opacity: 'var(--cr-mesh-front-op)' }} />
      {/* round the wall: dim the mesh + paper toward the curved edges */}
      <path d={meshFace} fill="url(#cr-mesh-shade)" />

      {/* foot band — polished steel ring, lit top shoulder + dark bottom seam */}
      <path d={baseFace} fill="url(#cr-steel)" />
      <path d={baseFace} fill="url(#cr-brush)" />
      <path d={`M ${100 - MESH_B.rx} ${MESH_B.cy} A ${MESH_B.rx} ${MESH_B.ry} 0 0 0 ${100 + MESH_B.rx} ${MESH_B.cy}`} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
      <path d={`M ${100 - BASE_B.rx} ${BASE_B.cy} A ${BASE_B.rx} ${BASE_B.ry} 0 0 0 ${100 + BASE_B.rx} ${BASE_B.cy}`} fill="none" stroke="rgba(0,0,0,0.34)" strokeWidth="1.3" strokeLinecap="round" />

      {/* rim collar — polished steel band at the top, over the mesh top edge */}
      <path d={collarFace} fill="url(#cr-steel)" />
      <path d={collarFace} fill="url(#cr-brush)" />
      {/* dark inner edge where the collar rolls into the mesh, for depth */}
      <path d={`M ${100 - RIM_B.rx} ${RIM_B.cy} A ${RIM_B.rx} ${RIM_B.ry} 0 0 0 ${100 + RIM_B.rx} ${RIM_B.cy}`} fill="none" stroke="rgba(0,0,0,0.26)" strokeWidth="1" strokeLinecap="round" />

      {/* the rolled top lip: one clean polished ring + a catch-light that sits
          exactly on its top arc (no diverging double line), and the opening's
          near lip — no offset inner stroke that reads as a misaligned edge */}
      <ellipse cx="100" cy={RIM_T.cy} rx={RIM_T.rx} ry={RIM_T.ry} fill="none" stroke="url(#cr-rim-top)" strokeWidth="4.6" />
      <path d={RIM_HL} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
