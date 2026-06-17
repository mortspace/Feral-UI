import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/*
 * Fur — a coat of fur for any silhouette: folders, cards, hearts, custom
 * SVG paths, or a run of text.
 *
 * Thousands of tiny curved strands drawn onto a single canvas: a thick soft
 * undercoat, a midcoat combed from a cowlick with lit tips, then a sparse
 * highlight pass. A fringe rooted on the silhouette's own boundary points
 * outward past the edge — that fringe is what makes it read as fur instead
 * of noise. No textures, no images, no dependencies.
 *
 * Every silhouette is rasterized once into an alpha mask. Inside-tests are
 * array lookups, the fringe comes from marching the mask's boundary (which
 * is what lets TEXT grow fur — including inside the holes of letters), and
 * the base coat is composited through the mask with source-atop.
 *
 * It's also pettable. Stroke it and strands bend with the pointer motion,
 * then spring back. The rAF loop only runs while strands are still moving,
 * so idle fur costs nothing.
 *
 * Speed comes from a few places:
 *  - strand state lives in one flat Float32Array (reused across rebuilds),
 *    so a rebuild allocates nothing per strand and never churns the GC —
 *    that churn, not the math, is what makes naive rebuilds hitch
 *  - strands group into colour buckets at build time and stroke as a few
 *    dozen batched paths instead of ~15k individual strokes
 *  - the undercoat never moves, so it bakes into the pre-rendered base
 *    along with the gradient + tuft blots; pet frames blit that back and
 *    restroke only the top coat
 *  - masks and boundary walks are cached per silhouette, and prop-change
 *    rebuilds coalesce to one per animation frame
 */

export type FurShape = 'folder' | 'card' | 'heart'

export interface FurProps {
  /** Coat colour — any CSS colour. Shadow roots and lit tips derive from it. */
  color?: string
  /** Built-in silhouette. Ignored when `path` or `text` is given. */
  shape?: FurShape
  /** Custom silhouette as an SVG path string, in `pathBox` coordinates. */
  path?: string
  /** Coordinate space of `path`; it gets scaled to fill the element. */
  pathBox?: { width: number; height: number }
  /** Grow the fur on text instead of a shape. Sized to fill the element. */
  text?: string
  /** Strand length multiplier. 1 = the default coat. */
  fluff?: number
  /** Strand count multiplier. Capped so huge elements stay cheap. */
  density?: number
  /** Direction chaos, 0..1 — 0 freshly combed, 1 slept on. */
  mess?: number
  /** Same seed + same size = the exact same fur. */
  seed?: number
  /** Fill the silhouette's interior holes with bare skin of this colour —
   *  e.g. the pink pads of a paw, where the coat parts. The fur fringe still
   *  overlaps their edges. */
  padColor?: string
  /** Pointer petting. Defaults on; forced off by prefers-reduced-motion. */
  pettable?: boolean
  className?: string
  style?: CSSProperties
  /** Rendered above the coat — labels, paper, googly eyes. */
  children?: ReactNode
}

// ---- strand storage ----
// One flat Float32Array, STRIDE floats per strand:
//   [x, y, a (rest angle), len, bend, d (pet deflection), v (deflection vel)]
// Style (colour/width) lives in the buckets so strokes can batch.
const STRIDE = 7

/** One batched stroke: strands order[start..end) share colour + width.
 *  `tip` buckets re-stroke only the outer half of midcoat strands; `under`
 *  buckets are baked into the static base and never repainted. */
type Bucket = { c: string; w: number; tip: boolean; under: boolean; start: number; end: number }

type Coat = {
  S: Float32Array // strand state, STRIDE floats each
  count: number // strands in use (S may have spare capacity)
  order: Int32Array // strand indices grouped by bucket
  buckets: Bucket[]
  stencil: HTMLCanvasElement // the silhouette, for compositing the base
  solidStencil: HTMLCanvasElement // holes filled, for the pad backing
  padColor: string | null
  grid: number[][] // cell -> dynamic strand indices (pointer lookup)
  cols: number
  rows: number
  cell: number
  bleed: number
  w: number
  h: number
  base: [h: number, s: number, l: number]
  /** soft tuft shadows / sheen spots blotched under the strands */
  blots: Array<{ x: number; y: number; r: number; c: string }>
}

const CELL = 48
const SVG_NS = 'http://www.w3.org/2000/svg'
// spring constants for the pet deflection (per 60fps frame)
const SPRING = 0.10
const DAMP = 0.88
const SETTLED = 0.004

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// ---- module-level caches, shared across every Fur instance ----

let hslProbe: CanvasRenderingContext2D | null = null

/** Normalize any CSS colour to HSL via the canvas fillStyle parser. */
function toHsl(color: string): [number, number, number] {
  if (!hslProbe) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    hslProbe = cv.getContext('2d')!
  }
  const x = hslProbe
  x.fillStyle = '#000'
  x.fillStyle = color
  const std = x.fillStyle as string
  let r = 0
  let g = 0
  let b = 0
  if (std.startsWith('#')) {
    r = parseInt(std.slice(1, 3), 16)
    g = parseInt(std.slice(3, 5), 16)
    b = parseInt(std.slice(5, 7), 16)
  } else {
    const m = std.match(/[\d.]+/g)
    if (m) [r, g, b] = [Number(m[0]), Number(m[1]), Number(m[2])]
  }
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const dlt = max - min
  const s = l > 0.5 ? dlt / (2 - max - min) : dlt / (max + min)
  let h: number
  if (max === r) h = ((g - b) / dlt + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / dlt + 2) / 6
  else h = ((r - g) / dlt + 4) / 6
  return [h * 360, s * 100, l * 100]
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsl(${h.toFixed(1)} ${Math.max(0, Math.min(100, s)).toFixed(1)}% ${Math.max(0, Math.min(98, l)).toFixed(1)}% / ${a})`
}

/** Classic folder silhouette — tab top-left, slanted shoulder, rounded body. */
function folderD(w: number, h: number): string {
  const r = Math.min(w, h) * 0.07
  const rt = r * 0.8
  const tabW = w * 0.4
  const tabH = h * 0.16
  const sl = tabH * 0.55
  return [
    `M 0 ${h - r}`,
    `L 0 ${rt}`,
    `Q 0 0 ${rt} 0`,
    `L ${tabW - rt} 0`,
    `Q ${tabW} 0 ${tabW + sl * 0.45} ${tabH * 0.45}`,
    `L ${tabW + sl} ${tabH * 0.82}`,
    `Q ${tabW + sl * 1.6} ${tabH} ${tabW + sl * 2.2} ${tabH}`,
    `L ${w - r} ${tabH}`,
    `Q ${w} ${tabH} ${w} ${tabH + r}`,
    `L ${w} ${h - r}`,
    `Q ${w} ${h} ${w - r} ${h}`,
    `L ${r} ${h}`,
    `Q 0 ${h} 0 ${h - r}`,
    'Z',
  ].join(' ')
}

function cardD(w: number, h: number): string {
  const r = Math.min(w, h) * 0.12
  return [
    `M ${r} 0`,
    `L ${w - r} 0`,
    `Q ${w} 0 ${w} ${r}`,
    `L ${w} ${h - r}`,
    `Q ${w} ${h} ${w - r} ${h}`,
    `L ${r} ${h}`,
    `Q 0 ${h} 0 ${h - r}`,
    `L 0 ${r}`,
    `Q 0 0 ${r} 0`,
    'Z',
  ].join(' ')
}

function heartD(w: number, h: number): string {
  const X = (v: number) => (v * w).toFixed(2)
  const Y = (v: number) => (v * h).toFixed(2)
  return [
    `M ${X(0.5)} ${Y(0.3)}`,
    `C ${X(0.5)} ${Y(0.14)} ${X(0.38)} ${Y(0.05)} ${X(0.26)} ${Y(0.05)}`,
    `C ${X(0.1)} ${Y(0.05)} ${X(0.02)} ${Y(0.18)} ${X(0.02)} ${Y(0.33)}`,
    `C ${X(0.02)} ${Y(0.58)} ${X(0.25)} ${Y(0.78)} ${X(0.5)} ${Y(0.96)}`,
    `C ${X(0.75)} ${Y(0.78)} ${X(0.98)} ${Y(0.58)} ${X(0.98)} ${Y(0.33)}`,
    `C ${X(0.98)} ${Y(0.18)} ${X(0.9)} ${Y(0.05)} ${X(0.74)} ${Y(0.05)}`,
    `C ${X(0.62)} ${Y(0.05)} ${X(0.5)} ${Y(0.14)} ${X(0.5)} ${Y(0.3)}`,
    'Z',
  ].join(' ')
}

const TEXT_FONT = `ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, 'Segoe UI', system-ui, sans-serif`

/** A custom path's bounding box, measured via a throwaway SVG element
 *  (getBBox handles relative commands and arbitrary coordinates that a
 *  number-scrape can't). Cached per d-string; lets any path auto-fit its
 *  element without the caller pre-computing a pathBox. */
const bboxCache = new Map<string, DOMRect>()

function getPathBBox(d: string): DOMRect {
  const hit = bboxCache.get(d)
  if (hit) return hit
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  const el = document.createElementNS(SVG_NS, 'path') as SVGPathElement
  el.setAttribute('d', d)
  svg.appendChild(el)
  document.body.appendChild(svg)
  let box: DOMRect
  try {
    box = el.getBBox()
  } finally {
    svg.remove()
  }
  if (bboxCache.size > 24) bboxCache.clear()
  bboxCache.set(d, box)
  return box
}

// ---- silhouettes ----
// A silhouette is an alpha mask + the canvas it was rasterized on (kept as
// the compositing stencil for the base coat) + its boundary, marched out of
// the mask with outward normals from the alpha gradient. Marching the mask
// instead of walking an SVG path is what lets text (with letter holes) grow
// a proper fringe — and it never touches the DOM, so slider-drag rebuilds
// stay cheap. Cached per key.

type Silhouette = {
  mask: Uint8ClampedArray
  stencil: HTMLCanvasElement
  /** the silhouette with interior holes filled — backing for `padColor` */
  solidStencil: HTMLCanvasElement
  /** boundary pixels with outward normal; `hole` = edge of an interior hole
   *  (a pad), not the outer silhouette */
  peri: Array<{ x: number; y: number; nx: number; ny: number; hole: boolean }>
  insideCount: number
}

const silCache = new Map<string, Silhouette>()

function getSilhouette(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): Silhouette {
  const hit = silCache.get(key)
  if (hit) return hit
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, w)
  cv.height = Math.max(1, h)
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#000'
  draw(ctx)
  const mask = ctx.getImageData(0, 0, cv.width, cv.height).data
  const W = cv.width
  const H = cv.height
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[(y * w + x) * 4 + 3]

  // flood-fill "outside" from the border through transparent pixels;
  // anything not reached is interior — silhouette OR a hole. (Run before the
  // perimeter scan so each boundary pixel can tell outer edge from hole.)
  const outside = new Uint8Array(W * H)
  const stack: number[] = []
  const pushIf = (i: number) => {
    if (i >= 0 && i < W * H && !outside[i] && mask[i * 4 + 3] <= 8) {
      outside[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < W; x++) {
    pushIf(x)
    pushIf((H - 1) * W + x)
  }
  for (let y = 0; y < H; y++) {
    pushIf(y * W)
    pushIf(y * W + W - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % W
    if (x > 0) pushIf(i - 1)
    if (x < W - 1) pushIf(i + 1)
    pushIf(i - W)
    pushIf(i + W)
  }
  const isOutside = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= W || y >= H ? true : outside[y * W + x] === 1

  const peri: Silhouette['peri'] = []
  let insideCount = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) <= 8) continue
      insideCount++
      const l = at(x - 1, y) > 8
      const r = at(x + 1, y) > 8
      const u = at(x, y - 1) > 8
      const dn = at(x, y + 1) > 8
      if (l && r && u && dn) continue
      // outward normal points at the missing neighbours
      const nx = (l ? 0 : -1) + (r ? 0 : 1)
      const ny = (u ? 0 : -1) + (dn ? 0 : 1)
      if (!nx && !ny) continue
      const m = Math.hypot(nx, ny)
      // probe a couple px along the normal: lands in true outside = outer
      // edge; lands in a not-outside gap = the rim of an interior hole
      const hole = !isOutside(Math.round(x + (nx / m) * 2), Math.round(y + (ny / m) * 2))
      peri.push({ x, y, nx: nx / m, ny: ny / m, hole })
    }
  }

  const solidCv = document.createElement('canvas')
  solidCv.width = W
  solidCv.height = H
  const sctx = solidCv.getContext('2d')!
  const solidImg = sctx.createImageData(W, H)
  const sd = solidImg.data
  for (let i = 0; i < W * H; i++) {
    if (!outside[i]) {
      sd[i * 4] = sd[i * 4 + 1] = sd[i * 4 + 2] = 0
      sd[i * 4 + 3] = 255
    }
  }
  sctx.putImageData(solidImg, 0, 0)

  if (silCache.size > 8) {
    const oldest = silCache.keys().next().value
    if (oldest !== undefined) silCache.delete(oldest)
  }
  const sil = { mask, stencil: cv, solidStencil: solidCv, peri, insideCount }
  silCache.set(key, sil)
  return sil
}

// palette sizes per layer (under / mid / highlight)
const N0 = 10
const N1 = 12
const N2 = 8
const NBUCKETS = N0 + N1 + N2

function buildCoat(
  w: number,
  h: number,
  opts: {
    color: string
    shape: FurShape
    path?: string
    pathBox?: { width: number; height: number }
    text?: string
    fluff: number
    density: number
    mess: number
    seed: number
    padColor?: string
  },
  prev: Coat | null,
): Coat {
  const rng = mulberry32(opts.seed)
  const [bh, bs, bl] = toHsl(opts.color)

  // resolve the silhouette in shape space (element px)
  let sil: Silhouette
  if (opts.text) {
    const text = opts.text
    sil = getSilhouette(`t|${text}|${w}x${h}`, w, h, (c) => {
      // a touch of letter-spacing keeps adjacent glyphs from merging once
      // the fringe grows around them; 0.9 width fit leaves breathing room
      type SpacedCtx = CanvasRenderingContext2D & { letterSpacing: string }
      const spaced = c as SpacedCtx
      try {
        spaced.letterSpacing = `${Math.round(h * 0.04)}px`
      } catch {
        /* older browsers: no letter-spacing, still legible */
      }
      c.font = `900 100px ${TEXT_FONT}`
      const tw = Math.max(1, c.measureText(text).width)
      const size = Math.min(((w * 0.9) / tw) * 100, h * 0.86)
      c.font = `900 ${size.toFixed(1)}px ${TEXT_FONT}`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(text, w / 2, h / 2)
    })
  } else if (opts.path) {
    // custom path — auto-fit and centre it in the element, preserving
    // aspect. pathBox is honoured if given (scale to that box from origin);
    // otherwise the path's measured bbox drives the fit, so a path at any
    // coordinates just works.
    const d = opts.path
    let m: DOMMatrix
    if (opts.pathBox) {
      m = new DOMMatrix([w / opts.pathBox.width, 0, 0, h / opts.pathBox.height, 0, 0])
    } else {
      const bb = getPathBBox(d)
      const pad = 0.92
      const sc = Math.min((w * pad) / bb.width, (h * pad) / bb.height)
      m = new DOMMatrix([sc, 0, 0, sc, (w - bb.width * sc) / 2 - bb.x * sc, (h - bb.height * sc) / 2 - bb.y * sc])
    }
    sil = getSilhouette(`p|${d}|${w}x${h}`, w, h, (c) => {
      const scaled = new Path2D()
      scaled.addPath(new Path2D(d), m)
      c.fill(scaled) // nonzero: overlapping subpaths read solid
    })
  } else {
    const d = opts.shape === 'card' ? cardD(w, h) : opts.shape === 'heart' ? heartD(w, h) : folderD(w, h)
    sil = getSilhouette(`s|${d}|${w}x${h}`, w, h, (c) => c.fill(new Path2D(d)))
  }
  const mask = sil.mask
  const inside = (x: number, y: number): boolean => {
    const xi = x | 0
    const yi = y | 0
    return xi >= 0 && yi >= 0 && xi < w && yi < h && mask[(yi * w + xi) * 4 + 3] > 8
  }

  const minDim = Math.min(w, h)
  // text wears shorter fur — long strands swallow the letterforms; the pile
  // needs to read as a coat ON the glyphs, not bury them
  const lenScale = opts.text ? 0.62 : 1
  const baseLen = Math.max(4, Math.min(22, minDim * 0.06)) * opts.fluff * lenScale
  const bleed = Math.ceil(baseLen * 1.6) + 4
  const mess = Math.max(0, Math.min(1, opts.mess))
  const headroom = Math.max(6, 94 - bl)

  // direction field: combed outward-down from a cowlick near the top —
  // how real pile fur lies on an upright surface. Two slow sine fields add
  // the gentle wave of a brushed coat; jitter stays small so it reads
  // combed, not slept-on (mess turns that back up).
  const cowX = w * (0.46 + rng() * 0.08)
  const cowY = h * 0.28
  const f1 = 0.035 + rng() * 0.02
  const f2 = 0.03 + rng() * 0.02
  const p1 = rng() * Math.PI * 2
  const p2 = rng() * Math.PI * 2
  const restAngle = (x: number, y: number): number => {
    const fromCow = Math.atan2(y - cowY, x - cowX)
    const clump = (Math.sin(x * f1 + p1) + Math.cos(y * f2 + p2)) * 0.3
    const dn = Math.PI / 2
    let a = fromCow + (((dn - fromCow + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.5
    a += clump * (0.5 + mess) + (rng() - 0.5) * (0.3 + mess * 1.6)
    return a
  }

  // tuft shadows + sheen spots — the depth pockets where real pile parts.
  // Painted under the strands; this is most of what makes it read plush.
  const blots: Coat['blots'] = []
  const blotCount = Math.round(sil.insideCount / 1800)
  let blotTries = blotCount * 6
  while (blots.length < blotCount && blotTries-- > 0) {
    const x = rng() * w
    const y = rng() * h
    if (!inside(x, y)) continue
    const dark = rng() < 0.68
    blots.push({
      x,
      y,
      r: baseLen * (1.3 + rng() * 1.6),
      c: dark
        ? hsl(bh + (rng() - 0.5) * 4, bs + 8, bl - 18 - rng() * 8, 0.16)
        : hsl(bh, bs * 0.9, bl + headroom * 0.2, 0.11),
    })
  }

  // ---- capacity + reusable buffers ----
  // density counts strands per px² of ACTUAL silhouette area, so text (which
  // covers a fraction of its box) gets the same pile as a solid folder
  const interior = Math.min(20000, Math.round(sil.insideCount * 0.16 * opts.density))
  const densityClamped = Math.max(0.5, Math.min(1.5, opts.density))
  const stride = 1.4 / densityClamped
  const edgeMax = Math.ceil(sil.peri.length / (stride * 0.7)) + 4
  const cap = interior + edgeMax

  let S: Float32Array
  let order: Int32Array
  if (prev && prev.S.length >= cap * STRIDE) {
    S = prev.S
    order = prev.order.length >= cap ? prev.order : new Int32Array(cap)
  } else {
    S = new Float32Array(cap * STRIDE)
    order = new Int32Array(cap)
  }
  // scratch: which bucket each strand belongs to (tiny, rebuilt every time)
  const bucketOf = new Uint8Array(cap)

  // ---- palettes ----
  // The whole coat lives in a NARROW lightness band around the base — wide
  // bands read as tinsel. Shadows go saturated (real pile does), tips
  // lighten only into the available headroom so pale coats never blow out.
  // A handful of variants per layer is indistinguishable from per-strand
  // jitter, and it lets every same-coloured strand stroke as ONE path.
  const palC: string[] = []
  const palTip: string[] = []
  const palW: number[] = []
  for (let v = 0; v < N0; v++) {
    palC.push(hsl(bh + (rng() - 0.5) * 5, bs + 6, bl - 12 - rng() * 9, 0.6))
    palTip.push('')
    palW.push(1.5 + rng() * 1.1)
  }
  for (let v = 0; v < N1; v++) {
    const jh = bh + (rng() - 0.5) * 5
    const js = bs + (rng() - 0.5) * 8
    const l = bl - 5 + rng() * 8
    palC.push(hsl(jh, js, l, 0.8))
    palTip.push(hsl(jh, js * 0.92, l + headroom * (0.12 + rng() * 0.1), 0.8))
    palW.push(0.8 + rng() * 0.6)
  }
  for (let v = 0; v < N2; v++) {
    palC.push(hsl(bh + (rng() - 0.5) * 5, (bs + (rng() - 0.5) * 8) * 0.85, bl + headroom * (0.25 + rng() * 0.12), 0.55))
    palTip.push('')
    palW.push(0.6 + rng() * 0.5)
  }

  // ---- strands, written straight into the flat buffer ----
  let count = 0
  const place = (x: number, y: number, a: number, edge: boolean, lenMul = 1) => {
    const roll = rng()
    const layer = roll < 0.4 ? 0 : roll < 0.92 ? 1 : 2
    let len = baseLen * (0.7 + rng() * 0.6) * (edge ? 0.9 : 1) * (layer === 0 ? 0.8 : 1) * lenMul
    // interior strands must not stray onto a pad or past the rim — clamp the
    // tip back inside the silhouette so pad edges stay crisp (only the
    // dedicated outer fringe is allowed past the boundary). Cheap: a couple
    // of mask lookups, and only the edge-adjacent strands actually shorten.
    if (!edge) {
      const dx = Math.cos(a)
      const dy = Math.sin(a)
      let guard = 0
      while (len > baseLen * 0.3 && !inside(x + dx * len, y + dy * len) && guard++ < 6) {
        len *= 0.78
      }
    }
    const o = count * STRIDE
    S[o] = x
    S[o + 1] = y
    S[o + 2] = a
    S[o + 3] = len
    S[o + 4] = (rng() - 0.5) * len * (0.7 + mess * 0.7)
    S[o + 5] = 0
    S[o + 6] = 0
    bucketOf[count] =
      layer === 0 ? (rng() * N0) | 0 : layer === 1 ? N0 + ((rng() * N1) | 0) : N0 + N1 + ((rng() * N2) | 0)
    count++
  }

  // interior roots — rejection sampled against the mask. Dense: a plush
  // pile is made of many fine hairs, not a few bold ones. The attempt
  // budget scales with how little of the box the silhouette covers.
  const coverage = Math.max(0.05, sil.insideCount / (w * h))
  let attempts = Math.ceil((interior / coverage) * 1.6)
  let placed = 0
  while (placed < interior && attempts-- > 0) {
    const x = rng() * w
    const y = rng() * h
    if (inside(x, y)) {
      place(x, y, restAngle(x, y), false)
      placed++
    }
  }

  // edge fringe — rooted on the marched boundary, pointing outward along
  // the mask normal but drooping toward gravity, short and dense so the
  // silhouette keeps its shape with a soft halo instead of going tinsel.
  // Hole rims (paw pads) get only SHORT, SPARSE wisps pointing inward — a
  // few tufts of fur licking over the pad edge (like a real paw), not the
  // long fringe that would bury the small beans.
  const fringePad = !!opts.padColor
  for (let fi = rng() * stride; fi < sil.peri.length && count < cap; fi += stride * (0.7 + rng() * 0.6)) {
    const p = sil.peri[fi | 0]
    const padRim = fringePad && p.hole
    if (padRim && rng() > 0.32) continue
    const out = Math.atan2(p.ny, p.nx)
    const dn = Math.PI / 2
    let a = out + (((dn - out + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.25
    a += (rng() - 0.5) * (0.35 + mess * (padRim ? 1.6 : 1.1))
    place(p.x, p.y, a, true, padRim ? 0.5 : 1)
  }

  // ---- group strands by bucket via counting sort (no per-strand pushes) ----
  const bucketCount = new Int32Array(NBUCKETS)
  for (let i = 0; i < count; i++) bucketCount[bucketOf[i]]++
  const bucketStart = new Int32Array(NBUCKETS)
  let acc = 0
  for (let b = 0; b < NBUCKETS; b++) {
    bucketStart[b] = acc
    acc += bucketCount[b]
  }
  const cursor = bucketStart.slice()
  for (let i = 0; i < count; i++) order[cursor[bucketOf[i]]++] = i

  // draw order: undercoat (baked static), midcoat bodies, lit tips, highlights
  const buckets: Bucket[] = []
  for (let v = 0; v < N0; v++) {
    if (bucketCount[v]) buckets.push({ c: palC[v], w: palW[v], tip: false, under: true, start: bucketStart[v], end: bucketStart[v] + bucketCount[v] })
  }
  for (let v = N0; v < N0 + N1; v++) {
    if (bucketCount[v]) buckets.push({ c: palC[v], w: palW[v], tip: false, under: false, start: bucketStart[v], end: bucketStart[v] + bucketCount[v] })
  }
  for (let v = N0; v < N0 + N1; v++) {
    if (bucketCount[v]) buckets.push({ c: palTip[v], w: palW[v] * 0.8, tip: true, under: false, start: bucketStart[v], end: bucketStart[v] + bucketCount[v] })
  }
  for (let v = N0 + N1; v < NBUCKETS; v++) {
    if (bucketCount[v]) buckets.push({ c: palC[v], w: palW[v], tip: false, under: false, start: bucketStart[v], end: bucketStart[v] + bucketCount[v] })
  }

  // ---- coarse spatial grid for pointer lookup. Only DYNAMIC strands go
  // in — the undercoat is baked into the base and can't be petted, which
  // also makes every pet frame ~40% cheaper. Cells reused when possible. ----
  const cols = Math.max(1, Math.ceil((w + bleed * 2) / CELL))
  const rows = Math.max(1, Math.ceil((h + bleed * 2) / CELL))
  let grid: number[][]
  if (prev && prev.cols === cols && prev.rows === rows) {
    grid = prev.grid
    for (const cellArr of grid) cellArr.length = 0
  } else {
    grid = Array.from({ length: cols * rows }, () => [])
  }
  for (let i = 0; i < count; i++) {
    if (bucketOf[i] < N0) continue // undercoat: static
    const o = i * STRIDE
    const rch = S[o + 3] + Math.abs(S[o + 4]) + 2
    const x0 = Math.max(0, Math.floor((S[o] - rch + bleed) / CELL))
    const x1 = Math.min(cols - 1, Math.floor((S[o] + rch + bleed) / CELL))
    const y0 = Math.max(0, Math.floor((S[o + 1] - rch + bleed) / CELL))
    const y1 = Math.min(rows - 1, Math.floor((S[o + 1] + rch + bleed) / CELL))
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) grid[gy * cols + gx].push(i)
  }

  return { S, count, order, buckets, stencil: sil.stencil, solidStencil: sil.solidStencil, padColor: opts.padColor ?? null, grid, cols, rows, cell: CELL, bleed, w, h, base: [bh, bs, bl], blots }
}

/** The static underpainting: silhouette gradient + tuft blots + belly
 *  light, all composited through the stencil's alpha. */
/** Bare-skin pads: the solid silhouette (holes filled) painted in padColor,
 *  with a soft vertical shade + a top sheen so the pads read as rounded skin
 *  rather than flat fills. */
function drawPads(ctx: CanvasRenderingContext2D, coat: Coat, padColor: string) {
  const [ph, ps, pl] = toHsl(padColor)
  ctx.drawImage(coat.solidStencil, 0, 0, coat.w, coat.h)
  ctx.globalCompositeOperation = 'source-atop'
  const g = ctx.createLinearGradient(0, 0, 0, coat.h)
  g.addColorStop(0, hsl(ph, ps, pl + 6))
  g.addColorStop(1, hsl(ph, ps + 4, pl - 12))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, coat.w, coat.h)
  ctx.globalCompositeOperation = 'source-over'
}

function drawBase(ctx: CanvasRenderingContext2D, coat: Coat) {
  const [bh, bs, bl] = coat.base
  ctx.drawImage(coat.stencil, 0, 0, coat.w, coat.h)
  ctx.globalCompositeOperation = 'source-atop'
  const g = ctx.createLinearGradient(0, 0, 0, coat.h)
  g.addColorStop(0, hsl(bh, bs * 0.9, bl - 8))
  g.addColorStop(1, hsl(bh, bs * 0.95, bl - 20))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, coat.w, coat.h)
  for (const b of coat.blots) {
    const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r)
    rg.addColorStop(0, b.c)
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rg
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2)
  }
  // belly light: a soft glow in the upper middle so the coat reads round
  const r = Math.max(coat.w, coat.h) * 0.55
  const rg = ctx.createRadialGradient(coat.w / 2, coat.h * 0.42, r * 0.1, coat.w / 2, coat.h * 0.42, r)
  rg.addColorStop(0, 'rgba(255,255,255,0.14)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, coat.w, coat.h)
  ctx.globalCompositeOperation = 'source-over'
}

/** Stroke one tier of buckets — `under` for the baked base pass, the rest
 *  for live frames. */
function strokeBuckets(ctx: CanvasRenderingContext2D, coat: Coat, under: boolean) {
  ctx.lineCap = 'round'
  const S = coat.S
  const order = coat.order
  for (const b of coat.buckets) {
    if (b.under !== under) continue
    ctx.strokeStyle = b.c
    ctx.lineWidth = b.w
    ctx.beginPath()
    if (b.tip) {
      for (let k = b.start; k < b.end; k++) {
        const o = order[k] * STRIDE
        const x = S[o]
        const y = S[o + 1]
        const len = S[o + 3]
        const a = S[o + 2] + S[o + 5]
        const ca = S[o + 2] + S[o + 5] * 0.55
        const cxp = x + Math.cos(ca) * len * 0.55 - Math.sin(ca) * S[o + 4]
        const cyp = y + Math.sin(ca) * len * 0.55 + Math.cos(ca) * S[o + 4]
        const tx = x + Math.cos(a) * len
        const ty = y + Math.sin(a) * len
        // the quad's midpoint at t=0.5 — re-stroke only the lit outer half
        ctx.moveTo((x + 2 * cxp + tx) / 4, (y + 2 * cyp + ty) / 4)
        ctx.quadraticCurveTo((cxp + tx) / 2, (cyp + ty) / 2, tx, ty)
      }
    } else {
      for (let k = b.start; k < b.end; k++) {
        const o = order[k] * STRIDE
        const x = S[o]
        const y = S[o + 1]
        const len = S[o + 3]
        const a = S[o + 2] + S[o + 5]
        const ca = S[o + 2] + S[o + 5] * 0.55
        const cxp = x + Math.cos(ca) * len * 0.55 - Math.sin(ca) * S[o + 4]
        const cyp = y + Math.sin(ca) * len * 0.55 + Math.cos(ca) * S[o + 4]
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(cxp, cyp, x + Math.cos(a) * len, y + Math.sin(a) * len)
      }
    }
    ctx.stroke()
  }
}

/** Repaint the live coat. Always full — partial clipped repaints leave
 *  hairline seams. The base (with the undercoat baked in) just blits. */
function paint(ctx: CanvasRenderingContext2D, coat: Coat, base: HTMLCanvasElement) {
  ctx.clearRect(-coat.bleed, -coat.bleed, coat.w + coat.bleed * 2, coat.h + coat.bleed * 2)
  ctx.drawImage(base, -coat.bleed, -coat.bleed, coat.w + coat.bleed * 2, coat.h + coat.bleed * 2)
  strokeBuckets(ctx, coat, false)
}

export function Fur({
  color = '#f5a8c9',
  shape = 'folder',
  path,
  pathBox,
  text,
  fluff = 1,
  density = 1,
  mess = 0.5,
  seed = 7,
  padColor,
  pettable = true,
  className,
  style,
  children,
}: FurProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // kept across effect re-runs so each rebuild can recycle the previous
  // coat's typed-array buffers + base canvas instead of reallocating
  const coatRef = useRef<Coat | null>(null)
  const baseCvRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    // a plain context: a desynchronized one shaves input latency on Chromium
    // but on some mobile browsers its layer composites as opaque black until
    // the first user-triggered repaint, flashing a black box behind the fur
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let coat: Coat | null = coatRef.current
    let baseCv: HTMLCanvasElement | null = baseCvRef.current
    let raf = 0
    let running = false
    let lastT = 0
    // strands currently springing back, by index
    const active = new Set<number>()
    let lastPX: number | null = null
    let lastPY: number | null = null

    let lastW = 0
    let lastH = 0
    const rebuild = () => {
      const r = wrap.getBoundingClientRect()
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      if (w < 4 || h < 4) return
      lastW = w
      lastH = h
      coat = buildCoat(w, h, { color, shape, path, pathBox, text, fluff, density, mess, seed, padColor }, coat)
      coatRef.current = coat
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const bw = (w + coat.bleed * 2) * dpr
      const bhh = (h + coat.bleed * 2) * dpr
      // setting canvas.width reallocates the backing store — skip when unchanged
      if (canvas.width !== bw || canvas.height !== bhh) {
        canvas.width = bw
        canvas.height = bhh
        canvas.style.inset = `${-coat.bleed}px`
        canvas.style.width = `${w + coat.bleed * 2}px`
        canvas.style.height = `${h + coat.bleed * 2}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, coat.bleed * dpr, coat.bleed * dpr)
      // pre-render base + undercoat once; pet frames blit it back and
      // restroke only the top coat
      if (!baseCv || baseCv.width !== bw || baseCv.height !== bhh) {
        baseCv = document.createElement('canvas')
        baseCv.width = bw
        baseCv.height = bhh
      }
      baseCvRef.current = baseCv
      const bctx = baseCv.getContext('2d')!
      bctx.setTransform(dpr, 0, 0, dpr, coat.bleed * dpr, coat.bleed * dpr)
      bctx.clearRect(-coat.bleed, -coat.bleed, w + coat.bleed * 2, h + coat.bleed * 2)
      if (coat.padColor) {
        // bare-skin pads fill the holes; the furry coat composites over them
        // (transparent in the holes) so pads show through and the fringe
        // overlaps their edges — like a real paw
        drawPads(bctx, coat, coat.padColor)
        const tmp = document.createElement('canvas')
        tmp.width = bw
        tmp.height = bhh
        const tctx = tmp.getContext('2d')!
        tctx.setTransform(dpr, 0, 0, dpr, coat.bleed * dpr, coat.bleed * dpr)
        drawBase(tctx, coat)
        strokeBuckets(tctx, coat, true)
        bctx.save()
        bctx.setTransform(1, 0, 0, 1, 0, 0)
        bctx.drawImage(tmp, 0, 0)
        bctx.restore()
      } else {
        drawBase(bctx, coat)
        strokeBuckets(bctx, coat, true)
      }
      active.clear()
      paint(ctx, coat, baseCv)
    }

    const frame = (now: number) => {
      if (!coat || !baseCv) {
        running = false
        return
      }
      const f = Math.max(0.25, Math.min(3, (now - lastT) / 16.7))
      lastT = now
      const S = coat.S
      let any = false
      for (const i of active) {
        const o = i * STRIDE
        let v = S[o + 6]
        let dd = S[o + 5]
        v += -SPRING * dd * f
        v *= Math.pow(DAMP, f)
        dd = Math.max(-1.1, Math.min(1.1, dd + v * f))
        if (Math.abs(dd) < SETTLED && Math.abs(v) < SETTLED) {
          dd = 0
          v = 0
          active.delete(i)
        }
        S[o + 5] = dd
        S[o + 6] = v
        any = true
      }
      if (any) paint(ctx, coat, baseCv)
      if (active.size > 0) raf = requestAnimationFrame(frame)
      else running = false
    }

    const wake = () => {
      if (running) return
      running = true
      lastT = performance.now()
      raf = requestAnimationFrame(frame)
    }

    const onMove = (e: PointerEvent) => {
      if (!coat) return
      const r = wrap.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      if (lastPX !== null && lastPY !== null) {
        const vx = px - lastPX
        const vy = py - lastPY
        const speed = Math.hypot(vx, vy)
        if (speed > 0.5) {
          const S = coat.S
          const R = Math.max(24, Math.min(coat.w, coat.h) * 0.16)
          const R2 = R * R
          // candidate strands from the cells the pointer circle covers
          const x0 = Math.max(0, Math.floor((px - R + coat.bleed) / coat.cell))
          const x1 = Math.min(coat.cols - 1, Math.floor((px + R + coat.bleed) / coat.cell))
          const y0 = Math.max(0, Math.floor((py - R + coat.bleed) / coat.cell))
          const y1 = Math.min(coat.rows - 1, Math.floor((py + R + coat.bleed) / coat.cell))
          for (let gy = y0; gy <= y1; gy++) {
            for (let gx = x0; gx <= x1; gx++) {
              for (const i of coat.grid[gy * coat.cols + gx]) {
                const o = i * STRIDE
                const dx = S[o] - px
                const dy = S[o + 1] - py
                const d2 = dx * dx + dy * dy
                if (d2 > R2) continue
                const g = 1 - d2 / R2
                // torque = stroke velocity across the strand direction
                const push = (vx * -Math.sin(S[o + 2]) + vy * Math.cos(S[o + 2])) / S[o + 3]
                S[o + 6] += push * g * 0.55
                active.add(i)
              }
            }
          }
          if (active.size > 0) wake()
        }
      }
      lastPX = px
      lastPY = py
    }
    const onLeave = () => {
      lastPX = null
      lastPY = null
    }

    // build synchronously on every dep change — the typed-array buffer reuse
    // (buildCoat takes `coat` to recycle) keeps a rebuild cheap, and a range
    // slider only commits ~once per frame, so per-render rebuilds don't
    // stack. Doing it sync (not via rAF) means colour/shape changes apply
    // immediately and never get lost to a throttled frame.
    rebuild()

    let resizeRaf = 0
    const ro = new ResizeObserver(() => {
      // RO fires once on observe with the current size — only an ACTUAL size
      // change warrants tearing the coat down, coalesced to one rebuild/frame
      const r = wrap.getBoundingClientRect()
      if (Math.round(r.width) === lastW && Math.round(r.height) === lastH) return
      cancelAnimationFrame(raf)
      running = false
      cancelAnimationFrame(resizeRaf)
      resizeRaf = requestAnimationFrame(() => rebuild())
    })
    ro.observe(wrap)

    const pets = pettable && !reduce
    if (pets) {
      wrap.addEventListener('pointermove', onMove)
      wrap.addEventListener('pointerleave', onLeave)
    }

    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
      cancelAnimationFrame(resizeRaf)
      if (pets) {
        wrap.removeEventListener('pointermove', onMove)
        wrap.removeEventListener('pointerleave', onLeave)
      }
    }
  }, [color, shape, path, pathBox?.width, pathBox?.height, text, fluff, density, mess, seed, padColor, pettable])

  return (
    <div ref={wrapRef} className={className ? `fur ${className}` : 'fur'} style={style}>
      <canvas ref={canvasRef} className="fur-canvas" aria-hidden="true" />
      {children != null && <div className="fur-content">{children}</div>}
    </div>
  )
}
