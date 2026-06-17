import { useCallback, useEffect, useRef, useState } from 'react'
import { useAnimate, useReducedMotion } from 'motion/react'
import { BinPhysicsPile, type BinPhysicsPileHandle } from './bin/BinPhysicsPile.tsx'
import { BIN_ART, PerspectiveBinBack, PerspectiveBinFront } from './bin/PerspectiveBin.tsx'
import { PaperBall } from './bin/PaperBall.tsx'
import { BALL_RF_REF, BITS, CLIP_BALL, CLIP_FLAT, CLIP_MID, SETTLE_EASE, ballRfForNote, buildLob } from './bin/crush.ts'
import crumpleSoundUrl from './sounds/paper-crumple.mp3'

const MOUTH_Y = BIN_ART.mouthY
const FLOOR_Y_FRAC = BIN_ART.floorY
// the SFX has ~41ms of lead-in silence — start playback past it so the first
// crinkle lands the instant the card starts crushing
const SOUND_LEAD = 0.04

/*
 * Crumple — a delete control for a stack of notes. Each delete crushes the
 * top card into a paper ball and tosses it in the wastepaper basket, which
 * visibly fills up as you go.
 *
 * Motion drives the crumple and toss; the pile inside the bin fills the floor
 * first (centre, then either side) and stacks tight like real trash.
 *
 *  1. CRUNCH — the card's edges collapse inward (an animated clip-path
 *     polygon), fold lines darken across it, paper flecks burst out, and the
 *     crumpled ball pops in over the wreck. On the first delete the basket
 *     rises from below WHILE the card crumples.
 *  2. TOSS   — the next card is already sliding up underneath as the ball
 *     squashes, hops, and drops straight down through the open mouth.
 *  3. INSIDE — drawn SVG bin in two layers sandwiching the pile: a dark
 *     cavity + floor disc behind, frosted glass + rim lip in front. At the
 *     mouth the flying ball hands off to a physics particle that drops to the
 *     drawn floor disc and packs against its neighbours — no slots, all solver.
 *  4. STAYS  — the basket rises on the first delete and then stays put, holding
 *     its haul and filling up ball by ball with every delete after. It doesn't
 *     sink away on its own; it's gone only when the component is remounted.
 *
 * Each ball is sized to the note it came from — a longer note is more paper, so
 * a bigger wad (see ballRfForNote). Flights are measured live (ball centre ->
 * basket mouth -> pile slot) so the toss lands true at any size. Honours
 * prefers-reduced-motion with a fade.
 */

export interface CrumpleNote {
  id: string | number
  title: string
  text?: string
  time?: string
}

export interface CrumpleProps {
  /** The stack of notes. A built-in demo set is used when omitted. */
  notes?: CrumpleNote[]
  /** Fired per note, the moment its ball lands in the basket. */
  onDelete?: (note: CrumpleNote, index: number) => void
  /** Fired once every note is gone and the basket has carried its haul away. */
  onEmpty?: () => void
  /** Accessible name for the delete button. */
  ariaLabel?: string
  /** Extra class on the stage wrapper. */
  className?: string
  /** How long the basket lingers after a delete (ms) before sinking away on its
   *  own. Deleting again before it sinks keeps it up; default 2500. */
  idleMs?: number
  /** Whether the crumple sound effect plays. **Off by default** — flip it on
   *  from a mute toggle (the demo wires a button to it). */
  sound?: boolean
  /** The crumple sound source — the built-in paper-crumple SFX by default; pass
   *  a URL for your own. Only plays when `sound` is true. */
  soundSrc?: string | null
  /** Crumple sound volume, 0–1. Default 0.5. */
  volume?: number
  /** Fire a short haptic tap on delete where supported (Android via the
   *  Vibration API; iOS 17.4+ via a hidden switch toggle). On by default. */
  haptics?: boolean
}

type Phase = 'idle' | 'running' | 'gone'

const DEFAULT_NOTES: CrumpleNote[] = [
  { id: 1, title: 'Buy oat milk', text: '2% is fine if they’re out. Also grab coffee filters.', time: '9:41' },
  { id: 2, title: 'Call the plumber', text: 'Kitchen tap still dripping — ask about Thursday.', time: 'Mon' },
  { id: 3, title: 'Gym at 6', text: 'Leg day. No excuses this time.', time: 'Sun' },
  { id: 4, title: 'Water the monstera', text: 'She’s looking dramatic again.', time: 'Sun' },
  { id: 5, title: 'Reply to Sam', text: 'About the weekend trip — yes to Saturday.', time: 'Fri' },
  { id: 6, title: 'Renew library books', text: 'Two are due back; the hold is ready to collect.', time: 'Thu' },
  { id: 7, title: 'Book the dentist', text: 'Six-month cleaning. Ask if they do evenings.', time: 'Wed' },
  { id: 8, title: 'Pay the electricity bill', text: 'Autopay bounced last month — check the card.', time: 'Tue' },
  { id: 9, title: 'Defrost the chicken', text: 'Take it out before you leave for work.', time: 'Tue' },
  { id: 10, title: 'Text Mom back', text: 'She asked about Sunday lunch.', time: 'Mon' },
  { id: 11, title: 'Cancel the free trial', text: 'Before they charge the card on the 15th.', time: 'Mon' },
  { id: 12, title: 'Find the passport', text: 'Renewal forms are due end of the month.', time: 'Sun' },
  { id: 13, title: 'Buy a birthday card', text: 'Dani’s is this weekend — don’t forget.', time: 'Sun' },
  { id: 14, title: 'Return the package', text: 'Label’s printed; drop it at the locker.', time: 'Sat' },
  { id: 15, title: 'Service the car', text: 'It’s making that noise again. Book it.', time: 'Sat' },
  { id: 16, title: 'Back up the laptop', text: 'It’s been three months. Do it tonight.', time: 'Fri' },
  { id: 17, title: 'Email the landlord', text: 'Ask about the radiator in the hall.', time: 'Fri' },
  { id: 18, title: 'Plan the weekend', text: 'Hike if it’s dry, museum if it rains.', time: 'Thu' },
  { id: 19, title: 'Refill prescription', text: 'Pharmacy closes at 6 on weekdays.', time: 'Thu' },
  { id: 20, title: 'Charge the headphones', text: 'Dead again — plug them in tonight.', time: 'Wed' },
]

// floor shadow under the pile (fraction of basket box height)
const FLOOR_Y = FLOOR_Y_FRAC

// The crush's creases ARE the PaperBall's creases, drawn flat over the sheet in
// the same 0–100 art box (stretched to the card by preserveAspectRatio="none").
// So when the ball fades in, its creases land exactly where the sheet's already
// were — object permanence; the fold pattern doesn't reshuffle at the hand-off.
const FOLD_CREASES = [
  'M40 27 L45 40 L50 60 L46 88',
  'M62 30 L57 46 L67 62 L70 83',
  'M45 40 L57 46',
  'M45 40 L35 56 L22 74',
  'M57 46 L67 62',
  'M50 60 L35 56',
  'M50 9 L40 27',
  'M50 9 L62 30',
]

/** Crease lines that darken across the card as it crushes — the ball's own creases. */
function FoldLines() {
  return (
    <svg className="cr-folds" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="rgba(82,82,88,0.3)" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round">
        {FOLD_CREASES.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  )
}

// ---- the basket --------------------------------------------------------------

export function Crumple({
  notes,
  onDelete,
  onEmpty,
  ariaLabel = 'Delete note',
  className,
  idleMs = 2500,
  sound = false,
  soundSrc = crumpleSoundUrl,
  volume = 0.5,
  haptics = true,
}: CrumpleProps) {
  const reduce = useReducedMotion()
  const [scope, animate] = useAnimate()
  const list = notes && notes.length > 0 ? notes : DEFAULT_NOTES

  const [phase, setPhase] = useState<Phase>('idle')
  const [index, setIndex] = useState(0)
  const [pileCount, setPileCount] = useState(0)
  const busy = useRef(false)
  const pending = useRef(0)
  const binUp = useRef(false)
  const idxRef = useRef(0)
  const fillRef = useRef(0)
  const ballRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const binRef = useRef<BinPhysicsPileHandle>(null)
  const sinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // crumple SFX state — Web Audio so rapid deletes overlap with no latency/cutoff
  const audio = useRef<{ ctx: AudioContext | null; buf: AudioBuffer | null; bytes: ArrayBuffer | null; loading: boolean }>({
    ctx: null,
    buf: null,
    bytes: null,
    loading: false,
  })
  const hapticRef = useRef<HTMLInputElement>(null)
  const animStack = useCallback(
    (props: Parameters<typeof animate>[1], options?: Parameters<typeof animate>[2]) => {
      const el = stackRef.current
      if (!el) return Promise.resolve()
      return animate(el, props, options).then(() => {})
    },
    [animate],
  )
  const onDeleteRef = useRef(onDelete)
  const onEmptyRef = useRef(onEmpty)
  onDeleteRef.current = onDelete
  onEmptyRef.current = onEmpty

  // park the basket below the stage until the first delete
  useEffect(() => {
    if (stackRef.current) void animate(stackRef.current, { y: 320 }, { duration: 0 })
  }, [])

  // After a delete the basket lingers; if no further delete arrives within
  // idleMs it sinks back below the stage — carrying its haul — and resets, so
  // the next delete brings a fresh empty basket up. Deleting again before it
  // sinks cancels this (see run) and keeps it up: that's the "sweet spot".
  const sinkAway = async () => {
    if (busy.current || !binUp.current) return
    busy.current = true
    binUp.current = false
    await Promise.all([
      animStack(
        { y: [0, -8, 320], rotate: [0, -1, 1.4], scaleX: 1, scaleY: 1 },
        { duration: 0.58, ease: ['easeOut', 'easeIn'], times: [0, 0.2, 1] },
      ),
      animate('.cr-bin-shadow', { opacity: 0 }, { duration: 0.4, delay: 0.1 }).then(() => {}),
    ])
    // off-stage now — empty the pile and reset out of sight
    fillRef.current = 0
    binRef.current?.clear()
    setPileCount(0)
    await animStack({ y: 320, rotate: 0 }, { duration: 0.001 })
    busy.current = false
    if (idxRef.current >= list.length) {
      setPhase('gone')
      onEmptyRef.current?.()
    }
    // a delete queued up while it was sinking brings it straight back
    if (pending.current > 0) {
      pending.current -= 1
      void run()
    }
  }

  const armLinger = () => {
    if (sinkTimer.current) clearTimeout(sinkTimer.current)
    sinkTimer.current = setTimeout(() => {
      sinkTimer.current = null
      void sinkAway()
    }, idleMs)
  }

  // warm the crumple sound once it's enabled (fetch the bytes, decode lazily on
  // first play) so the first delete after turning sound on fires with no delay
  useEffect(() => {
    if (!sound || !soundSrc) return
    let cancelled = false
    fetch(soundSrc)
      .then((r) => r.arrayBuffer())
      .then((ab) => {
        if (!cancelled) audio.current.bytes = ab
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sound, soundSrc])

  // tidy the linger timer + audio context on unmount
  useEffect(
    () => () => {
      if (sinkTimer.current) clearTimeout(sinkTimer.current)
      void audio.current.ctx?.close().catch(() => {})
    },
    [],
  )

  // mark the hidden haptic input as an iOS switch so 17.4+ plays a haptic when it
  // toggles; ignored everywhere else
  useEffect(() => {
    hapticRef.current?.setAttribute('switch', '')
  }, [])

  // fire the crumple SFX the instant a delete commits — one shot per crushed
  // note, trimmed past the lead-in so the crinkle lands on the crush. Never
  // throws: if audio is blocked/unavailable it silently no-ops.
  const playCrumple = () => {
    if (!sound || !soundSrc) return
    try {
      const a = audio.current
      if (!a.ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return
        a.ctx = new Ctx()
      }
      const ctx = a.ctx
      if (ctx.state === 'suspended') void ctx.resume()
      const fire = (buf: AudioBuffer) => {
        const src = ctx.createBufferSource()
        src.buffer = buf
        const gain = ctx.createGain()
        gain.gain.value = Math.max(0, Math.min(1, volume))
        src.connect(gain).connect(ctx.destination)
        src.start(0, Math.min(SOUND_LEAD, buf.duration))
      }
      if (a.buf) {
        fire(a.buf)
        return
      }
      if (a.loading) return
      a.loading = true
      const decode = (bytes: ArrayBuffer) =>
        ctx.decodeAudioData(bytes.slice(0)).then((buf) => {
          a.buf = buf
          fire(buf)
        })
      const ready = a.bytes ? decode(a.bytes) : fetch(soundSrc).then((r) => r.arrayBuffer()).then(decode)
      ready
        .catch(() => {})
        .finally(() => {
          a.loading = false
        })
    } catch {
      // audio unavailable — never let it break the crumple
    }
  }

  // a short haptic tap on delete. Android (+ some) get the Vibration API; iOS has
  // no web vibration, but toggling a hidden <input switch> nudges its system
  // haptic (17.4+). Best-effort and guarded — a silent no-op where unsupported.
  const triggerHaptic = () => {
    if (!haptics) return
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(12)
    } catch {
      /* ignore */
    }
    try {
      hapticRef.current?.click()
    } catch {
      /* ignore */
    }
  }

  const run = async () => {
    if (idxRef.current >= list.length) return
    // any delete cancels a pending sink — the basket stays up to catch the ball
    if (sinkTimer.current) {
      clearTimeout(sinkTimer.current)
      sinkTimer.current = null
    }
    // a click mid-flight queues the next delete
    if (busy.current) {
      pending.current += 1
      return
    }
    busy.current = true
    setPhase('running')
    playCrumple() // crumple SFX (when sound is on), synced to the delete
    triggerHaptic() // a short haptic tap on supported devices
    const idx = idxRef.current
    const note = list[idx]
    // notes is treated as an uncontrolled snapshot; if a consumer shrank or
    // replaced it out from under us there's nothing here to crush — bail
    // cleanly rather than read undefined and throw.
    if (!note) {
      busy.current = false
      setPhase('idle')
      return
    }
    const isLast = idx + 1 >= list.length
    // this note's wad size — bigger note, bigger ball (see ballRfForNote)
    const sizeRf = ballRfForNote(note)

    if (reduce) {
      // Reduced motion: keep the WHOLE concept — the basket still appears and
      // fills, ball by ball — but strip the crush, the toss arc and the rise
      // parallax. On the first delete the bin snaps into place (no travel); the
      // card fades and the wad simply appears at its resting spot in the pile.
      if (!binUp.current) {
        binUp.current = true
        void animStack({ y: 0, rotate: 0 }, { duration: 0 })
        void animate('.cr-bin-shadow', { opacity: [0, 0.55] }, { duration: 0.2 })
      }
      await animate('.cr-card-top', { opacity: 0, scale: 0.92 }, { duration: 0.22 })
      const fillIdx = fillRef.current
      binRef.current?.place(fillIdx, sizeRf)
      fillRef.current += 1
      setPileCount((n) => n + 1)
      onDeleteRef.current?.(note, idx)
      idxRef.current = idx + 1
      setIndex(idx + 1)
      busy.current = false
      // No auto-sink under reduce (that's a big travel) — the basket holds its
      // haul and stays put. onEmpty fires directly when the last note lands.
      if (isLast) {
        setPhase('gone')
        onEmptyRef.current?.()
      } else {
        setPhase('idle')
      }
      // serve any delete queued while this one was fading
      if (pending.current > 0) {
        pending.current -= 1
        void run()
      }
      return
    }

    const ease = [0.22, 0.61, 0.36, 1] as const

    // When the basket is down (first delete, or after it sank away) it rises
    // WHILE the card crumples, so the catcher is in place when the ball needs it.
    const risers: Array<Promise<void>> = []
    if (!binUp.current) {
      binUp.current = true
      // Let layout settle before motion writes the rise transform.
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      risers.push(
        animStack(
          { y: [320, -10, 0], rotate: [2.5, -1.5, 0] },
          { duration: 0.55, delay: 0.04, ease, times: [0, 0.75, 1] },
        ),
        animate('.cr-bin-shadow', { opacity: [0, 0.55] }, { duration: 0.4, delay: 0.2, ease: 'easeOut' }).then(() => {}),
      )
    }

    // Plan where this ball will land NOW, so the flight ball can be drawn at the
    // exact size it will rest at and the toss can arc straight to that spot — the
    // flight and the in-bin fall become one continuous motion (see TOSS below).
    const fillIdx = fillRef.current
    const dropPlan = binRef.current?.plan(fillIdx, sizeRf) ?? null
    const flightVd = dropPlan?.vd ?? Math.round(78 * (sizeRf / BALL_RF_REF))
    if (ballRef.current) {
      ballRef.current.style.width = `${flightVd}px`
      ballRef.current.style.height = `${flightVd}px`
    }

    // 1 — CRUNCH. The card swells for a beat — grabbed by an invisible fist —
    // then scrunches hard: edges buckle, folds darken, flecks burst out.
    const crunchT = { duration: 0.5, ease: [0.5, 0, 0.32, 1] as const, times: [0, 0.22, 0.6, 1] }
    const bitEls = Array.from(scope.current?.querySelectorAll('.cr-bit') ?? []) as HTMLElement[]
    bitEls.forEach((el, i) => {
      const b = BITS[i % BITS.length]
      animate(
        el,
        { x: [0, b.x], y: [0, b.y], opacity: [0, 1, 0], rotate: [0, b.x > 0 ? 130 : -130] },
        { duration: 0.5, delay: 0.18, ease: 'easeOut', times: [0, 0.25, 1] },
      )
    })
    await Promise.all([
      animate('.cr-card-top .cr-crush', { scale: [1, 1.06, 0.45, 0.26], rotate: [0, -2, 3.5, 6] }, crunchT),
      animate('.cr-card-top .cr-sheet', { clipPath: [CLIP_FLAT, CLIP_FLAT, CLIP_MID, CLIP_BALL] }, crunchT),
      animate('.cr-card-top .cr-card-inner', { opacity: [1, 0] }, { duration: 0.3, delay: 0.1, ease: 'easeIn' }),
      // folds top out at 0.85, not 1 — the shade now multiplies the sheet darker,
      // so full-strength creases would over-darken
      animate('.cr-card-top .cr-folds', { opacity: [0, 0.85] }, { duration: 0.3, delay: 0.12, ease: 'easeOut' }),
      // shading rides the SAME crunch curve as the clip morph — nothing until the
      // squeeze begins, then ramps hard into the final crumple, so the wad gains
      // the ball's lit-core / shadowed-edge dimension before the hand-off
      animate('.cr-card-top .cr-shade', { opacity: [0, 0, 0.85, 1] }, crunchT),
      animate('.cr-card-top .cr-shade-hi', { opacity: [0, 0, 0.7, 0.95] }, crunchT),
      // OBJECT PERMANENCE: the ball is already here, growing under the wreck at
      // opacity 0, reaching ~the crushed sheet's apparent size by crunch-end, so
      // the hand-off is a fade, not a spawn (scale 0.86 ≈ the sheet's ~64.5px).
      animate('.cr-ball', { scaleX: [0.62, 0.86], scaleY: [0.62, 0.86], opacity: 0 }, crunchT),
    ])

    // The wreck becomes the ball; the next card starts sliding up underneath
    // at the same moment (the deck promotion is a CSS transition). NB: onDelete
    // fires later, when the ball actually LANDS — not here mid-crunch.
    idxRef.current = idx + 1
    setIndex(idx + 1)
    // ONE beat: the crushed sheet blurs + dims out while the ball (already grown
    // to size under it) blurs + fades in over the SAME window. The symmetric blur
    // crosses at the midpoint, so neither edge is ever crisp alone — the flat
    // sheet and the shaded ball fuse into one soft shape during the swap
    // (skill: blur bridges two states into one).
    const HANDOFF = { duration: 0.26, ease: [0.26, 1, 0.5, 1] as const }
    await Promise.all([
      animate(
        '.cr-card-top .cr-sheet',
        { filter: ['blur(0px) brightness(1)', 'blur(4px) brightness(0.93)', 'blur(4px) brightness(0.9)'] },
        { ...HANDOFF, times: [0, 0.55, 1] },
      ),
      animate('.cr-card-top', { opacity: [1, 0.5, 0] }, { ...HANDOFF, times: [0, 0.5, 1] }),
      animate(
        '.cr-ball',
        { opacity: [0, 0.6, 1], scaleX: [0.86, 1, 1], scaleY: [0.86, 1, 1], filter: ['blur(4px)', 'blur(1.5px)', 'blur(0px)'] },
        { ...HANDOFF, times: [0, 0.5, 1] },
      ),
      animate('.cr-ball .cr-crease', { strokeDashoffset: [1, 0] }, { ...HANDOFF }),
      ...risers,
    ])
    // clear the sheet filter so the next top card starts crisp
    void animate('.cr-card-top .cr-sheet', { filter: 'blur(0px) brightness(1)' }, { duration: 0.001 })

    // 2 — TOSS + DROP as ONE continuous arc. We already planned where the ball
    // lands (dropPlan). Build a single lob from the ball straight to that resting
    // spot; the flight ball plays the part above the mouth, then at the rim hands
    // off — at the exact same point, size and speed — to the in-bin fall ball,
    // which plays the rest of the SAME arc. No pause, no second animation.

    // windup: a quick squeeze before the throw
    await animate('.cr-ball', { scaleX: [1, 1.2, 1], scaleY: [1, 0.74, 1], y: [0, 6, 0] }, { duration: 0.13, ease: 'easeOut' })

    const ballR = ballRef.current?.getBoundingClientRect()
    const stage = scope.current?.querySelector('.cr-pile-stage')?.getBoundingClientRect()
    const p0 = { x: (ballR?.left ?? 0) + (ballR?.width ?? 0) / 2, y: (ballR?.top ?? 0) + (ballR?.height ?? 0) / 2 }
    const p1 =
      stage && dropPlan
        ? { x: stage.left + dropPlan.localX, y: stage.top + dropPlan.localY }
        : { x: p0.x, y: p0.y + 200 }
    const mouthYv = (stage?.top ?? p0.y) + MOUTH_Y * (stage?.height ?? 200)

    const pts = buildLob(p0, p1, Math.max(34, Math.abs(p1.x - p0.x) * 0.22))
    let mouthIdx = pts.findIndex((p, i) => i > 0 && p.y >= mouthYv && pts[i - 1].y < mouthYv)
    if (mouthIdx < 1) mouthIdx = Math.round(pts.length * 0.5)
    const head = pts.slice(0, mouthIdx + 1)
    const tail = pts.slice(mouthIdx)
    const per = 0.6 / (pts.length - 1) // equal time per sample → continuous speed

    // head: the flight ball, in front of the bin, arcing down to the rim
    await animate(
      '.cr-ball',
      {
        x: head.map((p) => p.x - p0.x),
        y: head.map((p) => p.y - p0.y),
        rotate: head.map((_, i) => 8 + i * 7),
        scaleX: 1,
        scaleY: 1,
      },
      { duration: Math.max(0.12, per * mouthIdx), ease: 'linear' },
    )

    // hand-off at the rim: flight ball out, fall ball in — same point & size.
    // a soft ring ripples off the mouth and a little puff of paper dust kicks
    // up as the wad drops through — one tidy "swish-in" accent.
    animate('.cr-ball', { opacity: 0 }, { duration: 0.001 })
    animate(
      '.cr-gulp',
      { opacity: [0, 0.55, 0], scaleX: [0.82, 1, 1.18], scaleY: [0.82, 1, 1.18] },
      { duration: 0.44, ease: 'easeOut', times: [0, 0.28, 1] },
    )
    const puffEls = Array.from(scope.current?.querySelectorAll('.cr-fleck') ?? []) as HTMLElement[]
    puffEls.forEach((el, i) => {
      const dir = i % 2 === 0 ? -1 : 1
      animate(
        el,
        { x: [0, dir * (5 + (i % 2) * 4)], y: [0, -8 - (i % 3) * 4], opacity: [0, 0.8, 0], scale: [0.4, 1, 0.65] },
        { duration: 0.5, delay: i * 0.02, ease: 'easeOut', times: [0, 0.3, 1] },
      )
    })
    fillRef.current += 1
    setPileCount((n) => n + 1)
    const tailLocal = stage ? tail.map((p) => ({ x: p.x - stage.left, y: p.y - stage.top })) : tail
    await (binRef.current?.playFallAndSettle(fillIdx, tailLocal, flightVd, dropPlan?.scale ?? 1, dropPlan?.bright ?? 1, per * (pts.length - 1 - mouthIdx)) ??
      Promise.resolve())
    // the ball has LANDED — now honour the documented onDelete contract
    onDeleteRef.current?.(note, idx)

    // landed — the basket takes the hit: a shallow elastic give from the base
    // (a light wad barely dents it) that recovers a hair slower than the wad —
    // heavier vessel, correct mass relationship. All three reactions ride the
    // SAME decelerating curve (SETTLE_EASE) as the wad's settle and crest within
    // a frame of touchdown, so the whole landing resolves together. No tilt.
    animStack(
      { scaleY: [1, 0.972, 1.008, 0.998, 1], scaleX: [1, 1.012, 0.996, 1.001, 1], rotate: 0, y: 0 },
      { duration: 0.54, ease: SETTLE_EASE, times: [0, 0.16, 0.44, 0.72, 1] },
    )
    // the pile sinks-and-recovers in lockstep; the contact shadow blooms then breathes back
    animate('.cr-pile-canvas', { y: [0, 1.6, -0.4, 0] }, { duration: 0.5, ease: SETTLE_EASE, times: [0, 0.3, 0.66, 1] })
    animate('.cr-bin-shadow', { scaleX: [1, 1.06, 0.992, 1], scaleY: [1, 1.045, 0.994, 1] }, { duration: 0.5, ease: SETTLE_EASE, times: [0, 0.3, 0.66, 1] })

    // reset the flight ball for the next delete
    await Promise.all([
      animate('.cr-ball', { x: 0, y: 0, rotate: 6, scaleX: 1, scaleY: 1 }, { duration: 0.001 }),
      animate('.cr-ball .cr-crease', { strokeDashoffset: 1 }, { duration: 0.001 }),
    ])

    // 4 — LINGER. The ball's in. Serve any queued delete right away; otherwise
    // arm the linger — the basket holds for idleMs and then sinks away on its
    // own (sinkAway), unless another delete lands first and keeps it up.
    busy.current = false
    setPhase('idle')
    if (pending.current > 0) {
      pending.current -= 1
      void run()
    } else {
      armLinger()
    }
  }

  // the visible deck: top card plus up to two peeking behind it
  const deck = list.slice(index, index + 3)

  return (
    <div ref={scope} className={className ? `crumple ${className}` : 'crumple'} data-phase={phase}>
      {/* hidden control used only to nudge an iOS system haptic on delete (17.4+) */}
      <input ref={hapticRef} type="checkbox" className="cr-haptic" aria-hidden="true" tabIndex={-1} />
      <div className="cr-top">
        <div className="cr-deck">
          {deck.map((n, i) => (
            <div key={n.id} className={`cr-card ${i === 0 ? 'cr-card-top' : `cr-card-b${i}`}`}>
              <div className="cr-crush">
                <div className="cr-sheet" style={{ clipPath: CLIP_FLAT }}>
                  <div className="cr-shade" />
                  <div className="cr-shade-hi" />
                  <div className="cr-card-inner">
                    <button
                      type="button"
                      className="cr-del"
                      aria-label={`${ariaLabel}: ${n.title}`}
                      title={ariaLabel}
                      tabIndex={i === 0 ? 0 : -1}
                      aria-hidden={i !== 0}
                      onClick={i === 0 ? run : undefined}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <g className="cr-del-lid">
                          <path d="M5 7h14M10 4.5h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        </g>
                        <path
                          d="M7.5 7.5l.8 11a1.6 1.6 0 0 0 1.6 1.5h4.2a1.6 1.6 0 0 0 1.6-1.5l.8-11M10.2 11v5M13.8 11v5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <h4 className="cr-card-title">{n.title}</h4>
                    {n.text && <p className="cr-card-text">{n.text}</p>}
                    {n.time && <span className="cr-card-time">{n.time}</span>}
                  </div>
                  <FoldLines />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* paper flecks thrown off mid-crunch */}
        <div className="cr-bits" aria-hidden="true">
          {BITS.map((_, i) => (
            <span key={i} className="cr-bit" />
          ))}
        </div>

        <div className="cr-ball-wrap">
          <div className="cr-ball" ref={ballRef}>
            <PaperBall />
          </div>
        </div>
      </div>

      <div className="cr-bin-zone">
        <div className="cr-bin-spot">
          <div className="cr-bin-shadow" aria-hidden="true" />
          <div className="cr-bin-stack" ref={stackRef}>
            <PerspectiveBinBack />
            {pileCount > 0 && (
              <div
                className="cr-pile-shadow"
                aria-hidden="true"
                style={{
                  top: `${(FLOOR_Y + 0.008) * 100}%`,
                  width: `${38 + Math.min(pileCount, 4) * 10}%`,
                  opacity: Math.min(0.42 + pileCount * 0.06, 0.62),
                }}
              />
            )}
            <BinPhysicsPile ref={binRef} />
            <PerspectiveBinFront />
            <div className="cr-gulp" aria-hidden="true" />
          </div>
          <div className="cr-flecks" aria-hidden="true">
            <span className="cr-fleck" />
            <span className="cr-fleck" />
            <span className="cr-fleck" />
            <span className="cr-fleck" />
          </div>
        </div>
      </div>
    </div>
  )
}
