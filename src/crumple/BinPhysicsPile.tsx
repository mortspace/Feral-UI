import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { animate } from 'motion'
import { BIN_ART, BIN_INTERIOR_CLIP } from './PerspectiveBin.tsx'
import { PaperBall } from './PaperBall.tsx'
import { SETTLE_EASE } from './crush.ts'

/*
 * The pile inside the bin — FAKE 3D. Each ball is packed onto the bin's round
 * floor with a real depth coordinate, not stacked in a flat plane.
 *
 * World frame on the floor: wx (left/right), wz (back…front), wy (height above
 * the floor). The floor is a CIRCLE of radius = floor.rx in world space; it only
 * looks like a shallow ellipse because depth is foreshortened on screen:
 *
 *   screenX = floorCx + wx
 *   screenY = floorCy + wz * (floor.ry / floor.rx) - wy
 *
 * A new ball drops straight down at the (wx,wz) that scores best — lowest
 * resting height first (so the floor fills before anything stacks), gently
 * centred and front-biased — then rests tangent on whatever is below. Balls
 * toward the FRONT sit lower, draw larger and brighter and OVER the ones behind;
 * balls toward the BACK sit higher, smaller and dimmer. Painter's order by
 * screen-Y gives real front-to-back occlusion. Everything is deterministic
 * (varies by note radius + index), so the toss can aim at the spot it will land.
 */

interface Settled {
  id: number
  sx: number // screen x, fraction of box width
  sy: number // screen y, fraction of box height
  rf: number // base radius, fraction of box width
  scale: number // perspective size multiplier (front bigger)
  bright: number // depth brightness
  rot: number
}

interface World {
  wx: number
  wz: number
  wy: number
  r: number
}

export interface DropPlan {
  localX: number // resting centre x, pile-stage local px
  localY: number // resting centre y, pile-stage local px
  vd: number // base visual diameter, px (at depth scale 1)
  scale: number // depth size multiplier (front bigger)
  bright: number // depth brightness
}

export interface BinPhysicsPileHandle {
  /** Plan the next drop; returns where the ball will rest (pile-stage LOCAL px)
   *  plus its visual size/depth, so the toss can build ONE continuous arc from
   *  the card all the way down to this point. */
  plan: (index: number, rf?: number) => DropPlan | null
  /** Play the in-bin TAIL of that one arc on the fall ball (tail points are
   *  pile-stage LOCAL px centres) and commit the ball to the pile. The head of
   *  the same arc is played on the flight ball, so the motion is continuous and
   *  the swap at the mouth is seamless. */
  playFallAndSettle: (
    index: number,
    tail: Array<{ x: number; y: number }>,
    vd: number,
    scaleEnd: number,
    bright: number,
    dur: number,
  ) => Promise<void>
  /** Place a ball into the pile with no flight and no impact reaction — the
   *  reduced-motion path: the wad simply appears at its resting spot. */
  place: (index: number, rf?: number) => void
  clear: () => void
  count: () => number
}

const FLOOR_FRAC = BIN_ART.floorY
const FLOOR_RX_FRAC = BIN_ART.floor.rx / BIN_ART.w
const FORE = BIN_ART.floor.ry / BIN_ART.floor.rx // depth foreshortening on screen

// fallback radii (fraction of box width) when no per-note size is passed
const BALL_RF = [0.066, 0.058, 0.064, 0.056, 0.062, 0.06]

// the crumpled silhouette only fills ~78% of its SVG box, so paint each ball a
// touch larger than its collision radius and packed neighbours meet/overlap the
// way crushed paper nestles. Collision math uses the true radius; this is paint.
const VIS = 1.3

interface Geom {
  cx: number // floor centre x, px
  cy: number // floor centre y, px
  Rx: number // floor world radius, px
  fore: number // depth foreshorten ratio
  w: number
  h: number
}

const geomOf = (w: number, h: number): Geom => ({
  cx: w / 2,
  cy: FLOOR_FRAC * h,
  Rx: FLOOR_RX_FRAC * w,
  fore: FORE,
  w,
  h,
})

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Drop straight down at the best (wx,wz): scan the round floor footprint, rest
 *  each candidate tangent on whatever is below it, reject 3D overlaps, and pick
 *  the lowest / gently central-front spot. Floor fills before the pile stacks. */
function packBall(pile: World[], r: number, g: Geom, index: number): World {
  const lim = g.Rx - r
  const step = Math.max(1.6, r * 0.35)
  let best: World | null = null
  let bestScore = Infinity
  // a small deterministic lean so successive balls don't all chase one spot
  const leanX = ((index * 37) % 100) / 100 - 0.5
  for (let wx = -lim; wx <= lim; wx += step) {
    for (let wz = -lim; wz <= lim; wz += step) {
      if (wx * wx + wz * wz > lim * lim) continue
      // resting height here: floor (0) or tangent on the highest ball below
      let wy = 0
      for (const b of pile) {
        const d = Math.hypot(wx - b.wx, wz - b.wz)
        const sum = r + b.r
        if (d < sum) {
          const top = b.wy + Math.sqrt(sum * sum - d * d)
          if (top > wy) wy = top
        }
      }
      // no 3D overlap with anything (tangent contacts are allowed)
      let ok = true
      for (const b of pile) {
        if (Math.hypot(wx - b.wx, wz - b.wz, wy - b.wy) < r + b.r - 0.6) {
          ok = false
          break
        }
      }
      if (!ok) continue
      // floor first (wy dominates); then a gentle centre pull + only a MILD
      // front bias, so the first ball sits near the middle with room around it
      // instead of jammed against the front edge.
      let score = wy * 70 + (wx * wx + wz * wz) * 0.01 - wz * 0.05
      // spread SIDEWAYS: screenX === wx here, so a ball sharing a column with an
      // existing one stacks front-to-back and hides (or gets hidden) behind it.
      // Penalise sharing a column so neighbours nestle BESIDE each other; an
      // extra hit if the candidate would sit behind (and so be the hidden one).
      for (const b of pile) {
        const colGap = Math.abs(wx - b.wx)
        const colReach = (r + b.r) * 0.9
        if (colGap < colReach) {
          const overlap = (colReach - colGap) / colReach // 0..1
          score += overlap * 20
          if (wz < b.wz) score += overlap * 16
        }
      }
      // a small per-index lean just breaks left/right ties so it fills evenly
      score += Math.abs(wx - leanX * lim) * 0.04
      if (score < bestScore) {
        bestScore = score
        best = { wx, wz, wy, r }
      }
    }
  }
  return best ?? { wx: 0, wz: 0, wy: 0, r }
}

export const BinPhysicsPile = forwardRef<BinPhysicsPileHandle>(function BinPhysicsPile(_props, ref) {
  const [pile, setPile] = useState<Settled[]>([])
  const worldRef = useRef<World[]>([]) // physics coords, for packing
  const pileRef = useRef<Settled[]>([]) // render coords
  const boxRef = useRef<HTMLDivElement>(null)
  const fallRef = useRef<HTMLDivElement>(null)
  const plan = useRef<{ index: number; spot: World; g: Geom } | null>(null)

  const makePlan = (index: number, rf?: number) => {
    const box = boxRef.current?.getBoundingClientRect()
    const w = box?.width ?? BIN_ART.w
    const h = box?.height ?? BIN_ART.h
    const g = geomOf(w, h)
    const r = (rf ?? BALL_RF[index % BALL_RF.length]) * w
    const spot = packBall(worldRef.current, r, g, index)
    plan.current = { index, spot, g }
    return plan.current
  }

  const project = (s: World, g: Geom) => ({
    sx: g.cx + s.wx,
    sy: g.cy + s.wz * g.fore - s.wy,
  })

  const depthOf = (spot: World, g: Geom) => clamp01((spot.wz / g.Rx + 1) / 2)
  const scaleOf = (depth: number) => 1 + (depth - 0.5) * 0.16
  const brightOf = (depth: number) => 0.84 + depth * 0.22 // back dim … front bright

  // settle the cached plan's ball into the pile + run the impact reactions
  // (skipped when withImpact is false — the reduced-motion path wants no jolt)
  const commit = (index: number, withImpact = true) => {
    const p = plan.current
    if (!p || p.index !== index) return
    const { spot, g } = p
    const { sx, sy } = project(spot, g)
    const depth = depthOf(spot, g)
    const id = worldRef.current.length
    worldRef.current = [...worldRef.current, spot]
    const settled: Settled = {
      id,
      sx: sx / g.w,
      sy: sy / g.h,
      rf: spot.r / g.w,
      scale: scaleOf(depth),
      bright: brightOf(depth),
      rot: (index * 31) % 360,
    }
    // paint order: back-to-front (lower screenY first), front draws on top
    pileRef.current = [...pileRef.current, settled].sort((a, b) => a.sy - b.sy)
    setPile(pileRef.current)

    if (!withImpact) return

    // impact: the new ball squashes, neighbours it shoved get a quick jostle.
    // look elements up by stable id (paint order ≠ insertion order).
    requestAnimationFrame(() => {
      const root = boxRef.current
      if (!root) return
      const fresh = root.querySelector<HTMLElement>(`[data-ball-id="${id}"]`)
      if (fresh) {
        // touchdown settle: the wad arrives at full speed, so it opens already
        // compressed (no rest frame across the rAF hand-off → no dead-stop) and
        // sinks in, then rounds out with ONE small diminishing overshoot. scaleX
        // is volume-paired; y carries the centre down into contact. One damped
        // event on a single decelerating curve — not a fast hop + a squash.
        fresh.style.transformOrigin = '50% 92%'
        animate(
          fresh,
          { scaleX: [1.16, 0.97, 1.012, 1], scaleY: [0.8, 1.035, 0.992, 1], y: [-2, 0.8, -0.2, 0] },
          { duration: 0.5, ease: SETTLE_EASE, times: [0, 0.42, 0.72, 1] },
        )
      }
      for (const other of pileRef.current) {
        if (other.id === id) continue
        const dist = Math.hypot((other.sx - settled.sx) * g.w, (other.sy - settled.sy) * g.h)
        const reach = (other.rf + settled.rf) * g.w * 1.8
        if (dist > reach) continue
        const k = 1 - dist / reach
        const dir = other.sx <= settled.sx ? -1 : 1
        const el2 = root.querySelector<HTMLElement>(`[data-ball-id="${other.id}"]`)
        if (!el2) continue
        // nudged neighbour: a faint settle-lean (not a wobble) that comes to rest
        // just inside the wad's settle, on the same decelerating curve
        animate(
          el2,
          { rotate: [0, dir * 1.9 * k, -dir * 0.5 * k, 0], y: [0, 0.9 * k, 0] },
          { duration: 0.48, ease: SETTLE_EASE, times: [0, 0.3, 0.64, 1] },
        )
      }
    })
  }

  useImperativeHandle(ref, () => ({
    plan(index, rf) {
      if (!boxRef.current) return null
      const p = makePlan(index, rf)
      const { sx, sy } = project(p.spot, p.g)
      const depth = depthOf(p.spot, p.g)
      return { localX: sx, localY: sy, vd: 2 * p.spot.r * VIS, scale: scaleOf(depth), bright: brightOf(depth) }
    },

    async playFallAndSettle(index, tail, vd, scaleEnd, bright, dur) {
      const el = fallRef.current
      const restRot = (index * 31) % 360
      if (el && tail.length > 1) {
        el.style.width = `${vd}px`
        el.style.height = `${vd}px`
        el.style.filter = `brightness(${bright})`
        el.style.opacity = '1'
        const n = tail.length - 1
        const xs = tail.map((p) => p.x - vd / 2)
        const ys = tail.map((p) => p.y - vd / 2)
        const scales = tail.map((_, i) => 1 + (scaleEnd - 1) * (i / n))
        const rots = tail.map((_, i) => restRot - (n - i) * 6)
        await animate(el, { x: xs, y: ys, scale: scales, rotate: rots }, { duration: Math.max(0.12, dur), ease: 'linear' })
        el.style.opacity = '0'
      }
      commit(index)
    },

    place(index, rf) {
      if (!boxRef.current) return
      makePlan(index, rf)
      commit(index, false)
    },

    clear() {
      worldRef.current = []
      pileRef.current = []
      setPile([])
      plan.current = null
      if (fallRef.current) fallRef.current.style.opacity = '0'
    },

    count() {
      return worldRef.current.length
    },
  }))

  return (
    <div ref={boxRef} className="cr-pile-stage" style={{ clipPath: BIN_INTERIOR_CLIP }}>
      <div className="cr-pile-canvas">
        {pile.map((b) => {
          const vrf = b.rf * b.scale
          return (
            <div
              key={b.id}
              data-ball-id={b.id}
              className="cr-pile-spot"
              style={{
                left: `${b.sx * 100}%`,
                top: `${b.sy * 100}%`,
                width: `${vrf * VIS * 2 * 100}%`,
                aspectRatio: '1',
                marginLeft: `${-vrf * VIS * 100}%`,
                marginTop: `${-vrf * VIS * 100}%`,
              }}
            >
              <div className="cr-pile-ball" style={{ transform: `rotate(${b.rot}deg)`, filter: `brightness(${b.bright})` }}>
                <PaperBall drawn lite />
              </div>
            </div>
          )
        })}
        <div ref={fallRef} className="cr-fall-ball" aria-hidden="true">
          <PaperBall drawn lite />
        </div>
      </div>
    </div>
  )
})
