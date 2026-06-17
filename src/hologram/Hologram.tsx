import { useEffect, useId, useRef, type CSSProperties } from 'react'

/**
 * Holographic Pokémon card — a real foil shine over a full TCG card face.
 *
 * The card image is shown as-is; everything else is light played on top of it,
 * driven each frame by where the cursor is (idle = a slow cosine sweep). The
 * stack, bottom to top:
 *
 *   1. base        — the card face
 *   2. foil        — the card's signature pattern (see `pattern`/`tint`),
 *                    clipped to the art (or the whole card, see `mask`)
 *   3. glitter     — a sparkle tile (gen-sparkle.mjs), gated to the cursor
 *   4. bump sheen  — the SVG relief lit by a moving fePointLight (organHologram),
 *                    self-masking onto the darker art (overlay)
 *   5. glare       — a soft specular sheen following the cursor (soft-light)
 *   6. bevel       — an inset ring so the card reads as a physical edge
 *   + border glow  — borderLight, a soft glow sweeping the rim (sibling layer)
 *
 * Depth comes from the parts moving against each other: the card tilts in 3D and
 * lifts on hover, its shadow swings opposite the light, the gradients slide with
 * the cursor, and the bump relief hugs the art's form. Two fePointLights share
 * x/y so the foil and the border catch the light from the same direction.
 *
 * Pointer position is published as CSS vars (--px/--py, 0–100) on the card and a
 * --active level (idle→hover), so the foil layers react without React
 * re-rendering. Depth maps are synthesised per card by gen-card-depth.mjs.
 */

/** Foil pattern — each card's signature look. */
export type HologramFoil = 'rainbow' | 'cosmos' | 'linear' | 'rays' | 'tinsel'

/** Themed particle effect that drifts over (and past) the card. */
export type ParticleKind = 'embers' | 'bubbles' | 'motes' | 'psychic' | 'snow'

export interface HologramProps {
  /** the full card face image */
  src: string
  /** grayscale relief that drives the bump sheen; defaults to `src` */
  depth?: string
  /** card width in px (height follows `aspect`) */
  width?: number
  /** CSS aspect-ratio of the card face */
  aspect?: string
  /** corner radius in px */
  radius?: number
  /** foil pattern */
  pattern?: HologramFoil
  /** accent colour the pattern is tinted with */
  tint?: string
  /** main foil intensity, 0–1 */
  foil?: number
  /** glitter / sparkle over the art, 0–1 */
  glitter?: number
  /** specular glare that follows the cursor, 0–1 */
  glare?: number
  /** physical relief sheen, 0–1 (the SVG bump) */
  shine?: number
  /** how the bump sheen blends over the card */
  blend?: CSSProperties['mixBlendMode']
  /** themed particle effect, or false for none */
  particles?: ParticleKind | false
  /**
   * Where the foil sits:
   *   'window' — clipped to the top illustration band (standard cards)
   *   'full'   — the whole card (full-art / ex cards)
   *   string   — a custom CSS mask-image
   */
  mask?: 'window' | 'full' | (string & {})
  className?: string
  style?: CSSProperties
}

// The illustration window sits in the same band on every standard card we ship,
// so the foil is clipped to it (the rest stays matte, like a real holo).
// Full-art / ex cards instead foil edge-to-edge ('full').
const ART_MASK =
  'linear-gradient(to bottom, transparent 3.5%, #000 7.5%, #000 40%, transparent 46%)'

// pointer-anchored radial used to gate a pattern brightest under the cursor
const GATE = 'radial-gradient(circle at calc(var(--px) * 1%) calc(var(--py) * 1%),'

/**
 * The background recipe for a foil pattern, tinted with `tint`. Everything
 * blends `soft-light` (a gentle sheen, never additive `color-dodge`) and the
 * patterns are sparse + low-contrast, so the foil whispers over the art rather
 * than blazing — turn it up per card with the `foil` level if you want more.
 */
function foilLayer(pattern: HologramFoil, tint: string): CSSProperties {
  switch (pattern) {
    // secret-rare: a faint spectrum that slides + shifts hue with the tilt
    case 'rainbow':
      return {
        backgroundImage:
          `${GATE} rgba(255,255,255,0.35), rgba(255,255,255,0) 55%),` +
          'repeating-linear-gradient(110deg, #ff6b8b 0%, #ffd86b 14%, #7bffb2 28%, #5cc8ff 42%, #c79bff 56%, #ff6b8b 70%)',
        backgroundSize: '180% 180%, 320% 320%',
        backgroundPosition:
          'calc(var(--px) * 1%) calc(var(--py) * 1%), calc(var(--px) * -1.2%) calc(var(--py) * 1%)',
        backgroundBlendMode: 'overlay',
        filter: 'saturate(1.15) hue-rotate(calc((var(--px) - 50) * 1.3deg))',
        mixBlendMode: 'soft-light',
      }
    // galaxy: a slow swirl of colour that rotates as you move
    case 'cosmos':
      return {
        backgroundImage:
          `${GATE} rgba(255,255,255,0.3), rgba(255,255,255,0) 50%),` +
          `conic-gradient(from calc(var(--px) * 3.6deg) at 50% 45%, ${tint}, #c79bff, #ff6b8b, #ffd86b, #7bffb2, ${tint})`,
        backgroundSize: '150% 150%, 200% 200%',
        backgroundPosition: 'calc(var(--px) * 1%) calc(var(--py) * 1%), center',
        backgroundBlendMode: 'overlay',
        filter: 'saturate(1.1) brightness(0.95)',
        mixBlendMode: 'soft-light',
      }
    // vintage cracked-ice: faint tinted streaks, sparse, sliding across
    case 'linear':
      return {
        backgroundImage:
          `repeating-linear-gradient(112deg, transparent 0 14px, rgba(255,255,255,0.28) 15px, ${tint} 16px, rgba(255,255,255,0.28) 17px, transparent 18px 32px)`,
        backgroundSize: '200% 200%',
        backgroundPosition: 'calc(var(--px) * 2.4%) calc(var(--py) * 2.4%)',
        filter: 'saturate(1.15) hue-rotate(calc((var(--px) - 50) * 0.9deg))',
        mixBlendMode: 'soft-light',
      }
    // amazing-rare sunburst: sparse rays that fan as you tilt
    case 'rays':
      return {
        backgroundImage:
          `${GATE} rgba(255,255,255,0.28), rgba(255,255,255,0) 58%),` +
          `repeating-conic-gradient(from calc(var(--px) * 1.8deg) at 50% 44%, transparent 0deg, ${tint} 4.5deg, rgba(255,255,255,0.4) 6deg, ${tint} 7.5deg, transparent 16deg)`,
        backgroundSize: '170% 170%, 240% 240%',
        backgroundPosition: 'calc(var(--px) * 1%) calc(var(--py) * 1%), center',
        backgroundBlendMode: 'overlay',
        filter: 'saturate(1.1)',
        mixBlendMode: 'soft-light',
      }
    // confetti: leans on the glitter layer; a soft tinted wash under it
    case 'tinsel':
      return {
        backgroundImage: `${GATE} ${tint}, rgba(0,0,0,0) 60%)`,
        backgroundSize: '170% 170%',
        backgroundPosition: 'calc(var(--px) * 1%) calc(var(--py) * 1%)',
        filter: 'saturate(1.2) brightness(1.05)',
        mixBlendMode: 'soft-light',
      }
  }
}

// how far the particle canvas overhangs the card, so embers/bubbles spill past
const PARTICLE_MARGIN = 30

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

interface Particle {
  x: number; y: number; vx: number; vy: number; bx: number; cy: number
  life: number; max: number; size: number; seed: number; sway: number
  freq: number; ang: number; orbit: number; spin: number; bob: number
  star: boolean
}

/**
 * Themed canvas particles, one system per card kind. The canvas overhangs the
 * card by PARTICLE_MARGIN so things can drift past the edges. Each kind has its
 * own spawn / motion / draw: embers rise + flicker, bubbles wobble up and pop,
 * sparks crackle as little bolts, psychic orbs orbit the art, snow drifts down.
 */
function HologramParticles({ kind, tint }: { kind: ParticleKind; tint: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const [tr, tg, tb] = hexToRgb(tint)
    const M = PARTICLE_MARGIN
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let w = 0
    let h = 0
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      w = r.width
      h = r.height
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const rand = (a: number, b: number) => a + Math.random() * (b - a)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // card region inside the margined canvas
    const L = () => M
    const T = () => M
    const R = () => w - M
    const B = () => h - M
    const CW = () => w - 2 * M
    const CH = () => h - 2 * M

    const spawn = (p: Particle, initial: boolean) => {
      switch (kind) {
        case 'embers':
          p.x = L() + CW() * rand(0.1, 0.9)
          p.y = initial ? T() + CH() * rand(0.2, 1) : B() - rand(0, CH() * 0.12)
          p.vx = rand(-10, 10)
          p.vy = -rand(16, 40)
          p.size = rand(1, 3.4)
          p.max = rand(2.4, 5)
          p.life = initial ? rand(0, p.max) : p.max
          p.seed = rand(0, 6.28)
          p.sway = rand(6, 16)
          break
        case 'bubbles':
          p.bx = L() + CW() * rand(0.08, 0.92)
          p.x = p.bx
          p.y = initial ? T() + CH() * rand(0.1, 1) : B() + rand(0, 22)
          p.vy = -rand(10, 26)
          p.size = rand(2, 7)
          p.seed = rand(0, 6.28)
          p.sway = rand(5, 14)
          p.freq = rand(0.6, 1.6)
          break
        case 'motes':
          p.bx = L() + CW() * rand(0.05, 0.95)
          p.x = p.bx
          p.y = initial ? T() + CH() * rand(0, 1) : B() - rand(0, CH() * 0.1)
          p.vy = -rand(4, 11) // slow drift up
          p.size = rand(0.8, 2.2)
          p.max = rand(3, 6)
          p.life = initial ? rand(0, p.max) : p.max
          p.seed = rand(0, 6.28)
          p.sway = rand(8, 20)
          break
        case 'psychic':
          p.ang = rand(0, 6.28)
          p.orbit = rand(0.16, 0.46) * Math.min(CW(), CH())
          p.spin = rand(0.08, 0.26) * (Math.random() < 0.5 ? -1 : 1)
          p.size = rand(1, 3)
          p.bob = rand(3, 8)
          p.seed = rand(0, 6.28)
          p.cy = T() + CH() * rand(0.34, 0.5)
          break
        case 'snow':
          p.bx = L() + CW() * rand(-0.05, 1.05)
          p.x = p.bx
          p.y = initial ? T() + CH() * rand(0, 1) : T() - rand(0, 24)
          p.vy = rand(12, 30)
          p.size = rand(1, 3.2)
          p.seed = rand(0, 6.28)
          p.sway = rand(6, 16)
          p.freq = rand(0.4, 1.1)
          p.spin = rand(-1, 1)
          p.star = Math.random() < 0.32
          break
      }
    }

    const counts: Record<ParticleKind, number> = {
      embers: 42, bubbles: 30, motes: 16, psychic: 12, snow: 50,
    }
    const ps: Particle[] = []
    for (let i = 0; i < counts[kind]; i++) {
      const p = {} as Particle
      spawn(p, true)
      ps.push(p)
    }

    let last = performance.now()
    let t = 0
    let frame = 0

    const draw = () => {
      const now = performance.now()
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05
      t += dt
      ctx.clearRect(0, 0, w, h)

      for (const p of ps) {
        switch (kind) {
          case 'embers': {
            p.life -= dt
            p.vy -= 8 * dt // buoyancy: rise faster as they climb
            p.x += (p.vx + Math.sin(t * 1.5 + p.seed) * p.sway) * dt
            p.y += p.vy * dt
            if (p.life <= 0 || p.y < T() - M) spawn(p, false)
            const f = Math.max(0, p.life / p.max)
            const a = f * (0.6 + 0.4 * Math.sin(t * 12 + p.seed))
            const rr = p.size * (1 + (1 - f) * 1.4)
            ctx.globalCompositeOperation = 'lighter'
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 4)
            g.addColorStop(0, `rgba(255,244,206,${0.9 * a})`)
            g.addColorStop(0.4, `rgba(${tr},${tg},${tb},${0.5 * a})`)
            g.addColorStop(1, `rgba(${tr},${(tg * 0.35) | 0},0,0)`)
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.arc(p.x, p.y, rr * 4, 0, 6.2832)
            ctx.fill()
            break
          }
          case 'bubbles': {
            p.y += p.vy * dt
            p.x = p.bx + Math.sin(t * p.freq + p.seed) * p.sway
            if (p.y < T() - 6) spawn(p, false)
            const yn = (p.y - T()) / CH()
            const a = yn < 0.14 ? Math.max(0, yn / 0.14) : 1
            ctx.globalCompositeOperation = 'source-over'
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size, 0, 6.2832)
            ctx.fillStyle = `rgba(${tr},${tg},${tb},${0.1 * a})`
            ctx.fill()
            ctx.lineWidth = 1
            ctx.strokeStyle = `rgba(228,246,255,${0.55 * a})`
            ctx.stroke()
            ctx.beginPath()
            ctx.arc(p.x - p.size * 0.32, p.y - p.size * 0.32, Math.max(0.5, p.size * 0.22), 0, 6.2832)
            ctx.fillStyle = `rgba(255,255,255,${0.85 * a})`
            ctx.fill()
            break
          }
          case 'motes': {
            p.life -= dt
            p.y += p.vy * dt
            p.x = p.bx + Math.sin(t * 0.6 + p.seed) * p.sway
            if (p.life <= 0 || p.y < T() - M) spawn(p, false)
            const f = Math.max(0, p.life / p.max)
            // bell fade in/out over life + a gentle twinkle, kept very faint
            const a = Math.sin(Math.PI * f) * (0.45 + 0.4 * Math.sin(t * 2 + p.seed)) * 0.5
            const rr = p.size
            ctx.globalCompositeOperation = 'lighter'
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 4)
            g.addColorStop(0, `rgba(255,250,235,${0.7 * a})`)
            g.addColorStop(0.4, `rgba(${tr},${tg},${tb},${0.4 * a})`)
            g.addColorStop(1, `rgba(${tr},${tg},${tb},0)`)
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.arc(p.x, p.y, rr * 4, 0, 6.2832)
            ctx.fill()
            break
          }
          case 'psychic': {
            p.ang += p.spin * dt
            const cx = (L() + R()) / 2
            const x = cx + Math.cos(p.ang) * p.orbit
            const y = p.cy + Math.sin(p.ang) * p.orbit * 0.62 + Math.sin(t * 1 + p.seed) * p.bob
            // very subtle: low opacity, small soft glow
            const a = 0.16 + 0.2 * Math.abs(Math.sin(t * 0.6 + p.seed))
            const rr = p.size
            ctx.globalCompositeOperation = 'lighter'
            const g = ctx.createRadialGradient(x, y, 0, x, y, rr * 4)
            g.addColorStop(0, `rgba(238,224,255,${0.6 * a})`)
            g.addColorStop(0.4, `rgba(${tr},${tg},${tb},${0.35 * a})`)
            g.addColorStop(1, `rgba(${tr},${tg},${tb},0)`)
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.arc(x, y, rr * 4, 0, 6.2832)
            ctx.fill()
            break
          }
          case 'snow': {
            p.y += p.vy * dt
            p.x = p.bx + Math.sin(t * p.freq + p.seed) * p.sway
            if (p.y > B() + M) spawn(p, false)
            ctx.globalCompositeOperation = 'source-over'
            const tw = 0.6 + 0.4 * Math.sin(t * 5 + p.seed)
            if (p.star) {
              const s = p.size * 1.9 * (0.7 + 0.3 * tw)
              ctx.strokeStyle = `rgba(236,248,255,${0.9 * tw})`
              ctx.lineWidth = 1
              ctx.save()
              ctx.translate(p.x, p.y)
              ctx.rotate(t * p.spin * 0.5 + p.seed)
              for (let k = 0; k < 3; k++) {
                ctx.rotate(Math.PI / 3)
                ctx.beginPath()
                ctx.moveTo(-s, 0)
                ctx.lineTo(s, 0)
                ctx.stroke()
              }
              ctx.restore()
            } else {
              ctx.fillStyle = `rgba(240,250,255,${0.85 * tw})`
              ctx.beginPath()
              ctx.arc(p.x, p.y, p.size, 0, 6.2832)
              ctx.fill()
            }
            break
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over'
      if (!reduce) frame = requestAnimationFrame(draw)
    }

    draw() // first frame (and the only one under prefers-reduced-motion)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [kind, tint])

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        inset: -PARTICLE_MARGIN,
        width: `calc(100% + ${2 * PARTICLE_MARGIN}px)`,
        height: `calc(100% + ${2 * PARTICLE_MARGIN}px)`,
        pointerEvents: 'none',
        zIndex: 3,
      }}
    />
  )
}

export function Hologram({
  src,
  depth,
  width = 320,
  aspect = '733 / 1024',
  radius = 18,
  pattern = 'rainbow',
  tint = '#7cc5ff',
  foil = 0.28,
  glitter = 0.24,
  glare = 0.3,
  shine = 0.62,
  blend = 'overlay',
  particles = false,
  mask = 'window',
  className,
  style,
}: HologramProps) {
  const tiltRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const lightRef = useRef<SVGFEPointLightElement>(null)
  const borderLightRef = useRef<SVGFEPointLightElement>(null)

  const uid = useId().replace(/:/g, '')
  const organHologramId = `organ-${uid}`
  const borderLightId = `border-${uid}`

  // px coords for the fePointLights (anchored low for the bump look)
  const light = useRef({ x: width / 2, y: width * 0.7 })
  const lightTo = useRef({ x: width / 2, y: width * 0.7 })
  // 0–100 cursor position for the CSS gradient layers
  const view = useRef({ x: 50, y: 50 })
  const viewTo = useRef({ x: 50, y: 50 })
  // idle → hover intensity for the foil layers
  const active = useRef(0)
  const activeTo = useRef(0)
  const hovered = useRef(false)

  // rAF loop: lerp light + view + active toward targets, publish to the DOM
  useEffect(() => {
    let frame = 0
    let t = 0
    const tick = () => {
      const card = cardRef.current
      if (card) {
        const rect = card.getBoundingClientRect()
        if (!hovered.current) {
          // idle: sweep the light bottom <-> top, glare drifts with it
          t += 0.012
          const cycle = (1 - Math.cos(t / 2)) / 2
          lightTo.current.x = rect.width / 2
          lightTo.current.y = rect.height + 80 - cycle * (rect.height + 160)
          viewTo.current.x = 50 + Math.sin(t / 3) * 18
          viewTo.current.y = 100 - cycle * 100
          activeTo.current = 0.12
        }
        const k = 0.15
        light.current.x += (lightTo.current.x - light.current.x) * k
        light.current.y += (lightTo.current.y - light.current.y) * k
        view.current.x += (viewTo.current.x - view.current.x) * k
        view.current.y += (viewTo.current.y - view.current.y) * k
        active.current += (activeTo.current - active.current) * 0.1

        const lx = String(light.current.x)
        const ly = String(light.current.y)
        lightRef.current?.setAttribute('x', lx)
        lightRef.current?.setAttribute('y', ly)
        borderLightRef.current?.setAttribute('x', lx)
        borderLightRef.current?.setAttribute('y', ly)

        card.style.setProperty('--px', view.current.x.toFixed(2))
        card.style.setProperty('--py', view.current.y.toFixed(2))
        card.style.setProperty('--active', active.current.toFixed(3))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  // pointer events cover mouse, pen and touch — so a finger dragged across the
  // card on a phone tilts + lights it exactly like a hovering cursor does
  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current
    const tilt = tiltRef.current
    if (!card || !tilt) return
    const rect = card.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width // 0..1
    const py = (e.clientY - rect.top) / rect.height
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const angleY = -(e.clientX - cx) / 18
    const angleX = (e.clientY - cy) / 18

    // light anchored near the bottom; glare follows the cursor directly
    lightTo.current.x = rect.width / 2 + angleY * 90
    lightTo.current.y = rect.height + -angleX * 70
    viewTo.current.x = Math.max(0, Math.min(100, px * 100))
    viewTo.current.y = Math.max(0, Math.min(100, py * 100))
    activeTo.current = 1

    tilt.style.transition = 'transform 80ms ease-out'
    tilt.style.transform = `perspective(1100px) rotateX(${angleX}deg) rotateY(${angleY}deg) scale(1.045)`
    // shadow swings opposite the tilt so the card feels lifted
    card.style.boxShadow = `${-angleY * 1.5}px ${angleX * 1.5 + 24}px 50px rgba(0,0,0,0.4)`
    hovered.current = true
  }

  const handleLeave = () => {
    hovered.current = false
    activeTo.current = 0.12
    const tilt = tiltRef.current
    const card = cardRef.current
    if (tilt) {
      tilt.style.transform = 'perspective(1100px) rotateX(0deg) rotateY(0deg) scale(1)'
      tilt.style.transition = 'transform 500ms ease-out'
    }
    if (card) card.style.boxShadow = '0 24px 60px rgba(0,0,0,0.35)'
  }

  // shared positioning for the full-bleed overlay layers
  const fill: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  }
  // 'full' → no clip (foil edge-to-edge); 'window' → the art band; else custom
  const maskCss = mask === 'full' ? undefined : mask === 'window' ? ART_MASK : mask
  const maskBoth: CSSProperties = maskCss
    ? { WebkitMaskImage: maskCss, maskImage: maskCss }
    : {}

  return (
    <div
      ref={tiltRef}
      className={className}
      onPointerMove={handleMove}
      onPointerDown={handleMove}
      onPointerLeave={handleLeave}
      onPointerUp={handleLeave}
      onPointerCancel={handleLeave}
      style={{
        transform: 'perspective(1100px) rotateX(0deg) rotateY(0deg)',
        transition: 'transform 500ms ease-out',
        transformStyle: 'preserve-3d',
        ...style,
      }}
    >
      <div style={{ position: 'relative', width, aspectRatio: aspect }}>
        <div
          ref={cardRef}
          style={
            {
              position: 'relative',
              width: '100%',
              height: '100%',
              borderRadius: radius,
              overflow: 'hidden',
              boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
              '--px': '50',
              '--py': '50',
              '--active': '0',
            } as CSSProperties
          }
        >
          {/* 1 · base card face */}
          <img src={src} alt="" draggable={false} style={{ ...fill, objectFit: 'cover' }} />

          {/* 2 · foil — the card's signature pattern, gated under the cursor */}
          <div
            style={{
              ...fill,
              ...maskBoth,
              opacity: `calc(var(--active) * ${foil})`,
              ...foilLayer(pattern, tint),
            }}
          />

          {/* 3 · glitter — sparkle tile gated by a cursor radial */}
          <div
            style={{
              ...fill,
              ...maskBoth,
              opacity: `calc(var(--active) * ${glitter})`,
              backgroundImage:
                // opaque white→black so multiply keeps sparkle only under the cursor
                'radial-gradient(circle at calc(var(--px) * 1%) calc(var(--py) * 1%), #fff, #000 45%),' +
                'url(/cards/sparkle.png)',
              backgroundSize: '200% 200%, 168px 168px',
              backgroundPosition: 'center, calc(var(--px) * 0.5%) calc(var(--py) * 0.5%)',
              backgroundBlendMode: 'multiply',
              filter: 'brightness(1.02) contrast(1.05)',
              mixBlendMode: 'screen',
            }}
          />

          {/* SVG filter defs */}
          <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden>
            {/* Border glow: blur stroke → light it → mask back to stroke shape */}
            <filter id={borderLightId}>
              <feGaussianBlur in="SourceGraphic" stdDeviation="20" result="b" />
              <feDiffuseLighting in="b" surfaceScale="20" diffuseConstant="2.2" lightingColor="white" result="lit">
                <fePointLight ref={borderLightRef} x={width / 2} y={width * 0.7} z="50" />
              </feDiffuseLighting>
              <feColorMatrix
                in="lit"
                type="matrix"
                values="0 0 0 0 1
                        0 0 0 0 1
                        0 0 0 0 1
                        0.299 0.587 0.114 0 0"
                result="litAlpha"
              />
              <feComposite in="litAlpha" in2="SourceGraphic" operator="in" />
            </filter>

            {/* Organ hologram: dark areas → bump → light → mask */}
            <filter id={organHologramId} x="0" y="0" width="100%" height="100%">
              <feColorMatrix
                in="SourceGraphic"
                type="matrix"
                values="0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        -0.299 -0.587 -0.114 1 0.1"
                result="bumpRaw"
              />
              <feGaussianBlur in="bumpRaw" stdDeviation="1.5" result="bump" />
              <feDiffuseLighting in="bump" surfaceScale="15" diffuseConstant="0.5" lightingColor="white" result="lit">
                <fePointLight ref={lightRef} x={width * 0.5} y={width * 0.7} z="60" />
              </feDiffuseLighting>
              <feColorMatrix
                in="lit"
                type="matrix"
                values="0 0 0 0 1
                        0 0 0 0 1
                        0 0 0 0 1
                        0.299 0.587 0.114 0 0"
                result="litAlpha"
              />
              <feComposite in="litAlpha" in2="bumpRaw" operator="in" />
            </filter>
          </svg>

          {/* 4 · bump sheen — the lit relief, hugging the art's form */}
          <div
            style={{
              ...fill,
              filter: `url(#${organHologramId})`,
              mixBlendMode: blend,
              opacity: shine,
            }}
          >
            <img src={depth ?? src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>

          {/* 5 · glare — soft, broad specular sheen following the cursor */}
          <div
            style={{
              ...fill,
              opacity: `calc(0.04 + var(--active) * ${glare})`,
              background:
                'radial-gradient(circle at calc(var(--px) * 1%) calc(var(--py) * 1%), rgba(255,255,255,0.2), rgba(255,255,255,0) 72%)',
              mixBlendMode: 'soft-light',
            }}
          />

          {/* 6 · bevel — inset ring so the card reads as a physical edge */}
          <div
            style={{
              ...fill,
              borderRadius: radius,
              boxShadow:
                'inset 0 0 0 1px rgba(255,255,255,0.2), inset 0 1px 5px rgba(255,255,255,0.16), inset 0 -8px 22px rgba(0,0,0,0.2)',
            }}
          />
        </div>

        {/* Glowing border — sibling of card so it can spill past overflow:hidden */}
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            mixBlendMode: 'soft-light',
            overflow: 'visible',
            pointerEvents: 'none',
          }}
          preserveAspectRatio="none"
          aria-hidden
        >
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            rx={radius}
            ry={radius}
            fill="none"
            stroke="white"
            strokeWidth={2}
            style={{ filter: `url(#${borderLightId})` }}
          />
        </svg>

        {/* Themed particles — a sibling so they can spill past overflow:hidden */}
        {particles && <HologramParticles kind={particles} tint={tint} />}
      </div>
    </div>
  )
}

/** A card shipped in /cards: filename id, name, foil signature + intensities. */
export interface HologramCardInfo {
  id: string
  name: string
  pattern: HologramFoil
  tint: string
  /** themed particle effect */
  particles: ParticleKind
  /** foil region; defaults to 'window' (standard cards) */
  mask?: 'window' | 'full' | (string & {})
  /** per-card intensity defaults (0–1) */
  fx: { foil: number; glitter: number; glare: number; shine: number }
}

/** The TCG card faces served from /cards, each with its own foil + particles. */
export const HOLOGRAM_CARDS: HologramCardInfo[] = [
  // full-art ex — foil edge-to-edge; kept extra restrained since the art is busy
  { id: 'charizard-ex', name: 'Charizard ex', pattern: 'rays', tint: '#ff8a1e', particles: 'embers', mask: 'full', fx: { foil: 0.2, glitter: 0.14, glare: 0.28, shine: 0.55 } },
  { id: 'blastoise-ex', name: 'Blastoise ex', pattern: 'rays', tint: '#2fb6ff', particles: 'bubbles', mask: 'full', fx: { foil: 0.2, glitter: 0.14, glare: 0.28, shine: 0.55 } },
  // standard holos — each a different foil + particle theme
  { id: 'pikachu-hif', name: 'Pikachu', pattern: 'cosmos', tint: '#7fe0ff', particles: 'motes', fx: { foil: 0.26, glitter: 0.26, glare: 0.24, shine: 0.55 } },
  { id: 'pikachu-paf', name: 'Pikachu', pattern: 'tinsel', tint: '#ffd454', particles: 'motes', fx: { foil: 0.2, glitter: 0.32, glare: 0.26, shine: 0.6 } },
  { id: 'mewtwo', name: 'Mewtwo', pattern: 'cosmos', tint: '#9a5cff', particles: 'psychic', fx: { foil: 0.28, glitter: 0.24, glare: 0.24, shine: 0.58 } },
  { id: 'charmeleon-151', name: 'Charmeleon', pattern: 'linear', tint: '#ff8a4c', particles: 'embers', fx: { foil: 0.28, glitter: 0.12, glare: 0.28, shine: 0.62 } },
  { id: 'charmander', name: 'Charmander', pattern: 'linear', tint: '#ffae3c', particles: 'embers', fx: { foil: 0.26, glitter: 0.12, glare: 0.26, shine: 0.58 } },
  { id: 'charmeleon', name: 'Charmeleon', pattern: 'rainbow', tint: '#ff9a5c', particles: 'embers', fx: { foil: 0.3, glitter: 0.18, glare: 0.28, shine: 0.58 } },
  { id: 'moltres', name: 'Moltres', pattern: 'rays', tint: '#ff5a2a', particles: 'embers', fx: { foil: 0.26, glitter: 0.18, glare: 0.28, shine: 0.62 } },
  { id: 'swinub', name: 'Swinub', pattern: 'tinsel', tint: '#bfe6ff', particles: 'snow', fx: { foil: 0.2, glitter: 0.3, glare: 0.22, shine: 0.55 } },
  { id: 'seel', name: 'Seel', pattern: 'linear', tint: '#5cc8ff', particles: 'bubbles', fx: { foil: 0.26, glitter: 0.14, glare: 0.26, shine: 0.58 } },
  { id: 'dewgong', name: 'Dewgong', pattern: 'cosmos', tint: '#8fe3ff', particles: 'snow', fx: { foil: 0.26, glitter: 0.24, glare: 0.24, shine: 0.58 } },
]

/** Build the face + relief URLs for a card id served from /cards. */
export function cardImages(id: string): { src: string; depth: string } {
  return { src: `/cards/${id}.jpg`, depth: `/cards/${id}-depth.jpg` }
}
