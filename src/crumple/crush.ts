/*
 * Crumple-and-toss primitives — the crush keyframes, the wad sizing and the
 * flight arc that turn a flat note into a paper ball lobbed into the basket.
 * Factored out of Crumple.tsx so the constants and pure helpers sit on their own.
 */

/** The bit of a note/page the wad size reads from — just its text content. */
export interface CrushNote {
  title: string
  text?: string
}

// ---- the crumple itself: three clip-path keyframes, 16 points each ----------
// FLAT is a perfectly straight rectangle (all 16 points sit dead on the edges),
// so a resting sheet reads as a clean card — border-radius rounds the corners,
// and a full-rect clip-path doesn't clip that rounding away. The 16 points are
// only here so it can morph point-for-point into the crushed shapes below.
export const CLIP_FLAT =
  'polygon(0% 0%, 18% 0%, 38% 0%, 60% 0%, 82% 0%, 100% 0%, 100% 26%, 100% 52%, 100% 78%, 100% 100%, 72% 100%, 46% 100%, 20% 100%, 0% 100%, 0% 62%, 0% 30%)'
export const CLIP_MID =
  'polygon(5% 7%, 19% 4%, 37% 9%, 59% 3%, 79% 8%, 94% 5%, 91% 27%, 96% 50%, 90% 73%, 93% 92%, 69% 87%, 45% 94%, 21% 89%, 8% 92%, 10% 60%, 5% 31%)'
export const CLIP_BALL =
  'polygon(21% 17%, 31% 9%, 43% 19%, 55% 11%, 69% 21%, 81% 15%, 75% 33%, 85% 50%, 73% 67%, 79% 81%, 61% 73%, 47% 83%, 33% 75%, 25% 79%, 29% 57%, 17% 35%)'

// paper flecks thrown off mid-crunch
export const BITS: Array<{ x: number; y: number }> = [
  { x: -74, y: -44 },
  { x: 62, y: -56 },
  { x: -88, y: 4 },
  { x: 84, y: -10 },
  { x: -50, y: 48 },
  { x: 58, y: 42 },
  { x: -16, y: -72 },
  { x: 24, y: 60 },
]

// The one decelerating curve every landing-impact reaction shares — the wad's
// touchdown squash, the bin's elastic give, the neighbour jostle and the contact
// shadow all decay on THIS curve, so the whole settle resolves together and
// nothing snaps back early or twitches.
export const SETTLE_EASE: [number, number, number, number] = [0.16, 0.84, 0.32, 1]

// A sheet crumples into a ball whose size tracks how much it holds — more text
// is more paper, so a bigger wad. We take its content length and map it into the
// radius range the pile can still pack, clamped so a wall of text still nestles
// in and a one-liner still reads as a ball. Returned as a fraction of the bin box
// width (the unit the pile uses).
export const BALL_RF_MIN = 0.067
export const BALL_RF_MAX = 0.086
// Calibrates the flying ball's pixel size to the wad it becomes, so the flight
// hands off to the settled ball at the same size (no size pop at the mouth):
// 78px × 0.56 toss-end scale = the pile ball's drawn diameter at this rf.
export const BALL_RF_REF = 0.084

export function ballRfForNote(note: CrushNote): number {
  const chars = note.title.length + (note.text?.length ?? 0)
  const t = Math.min(1, Math.max(0, (chars - 35) / (70 - 35)))
  return BALL_RF_MIN + t * (BALL_RF_MAX - BALL_RF_MIN)
}

/** One continuous lob arc from p0 to p1 (viewport-px centres): rises to an apex,
 *  falls through the mouth and lands cleanly at the resting spot. The touchdown
 *  settle is a damped squash on the landed wad (see commit), NOT part of this arc.
 *  Equal-time samples, so the spacing alone encodes gravity — playing the head on
 *  the flight ball and the tail on the in-bin fall ball reads as ONE motion. */
export function buildLob(p0: { x: number; y: number }, p1: { x: number; y: number }, apexRise: number) {
  const apexY = Math.min(p0.y, p1.y) - apexRise
  const vy0 = -Math.sqrt(2 * Math.max(1, p0.y - apexY)) // gravity g = 1
  const disc = Math.max(0, vy0 * vy0 - 2 * (p0.y - p1.y))
  const T = -vy0 + Math.sqrt(disc)
  const N = 30
  const pts: Array<{ x: number; y: number }> = []
  for (let k = 0; k <= N; k++) {
    const t = (k / N) * T
    pts.push({ x: p0.x + ((p1.x - p0.x) * t) / T, y: p0.y + vy0 * t + 0.5 * t * t })
  }
  return pts
}
