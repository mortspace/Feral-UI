/* Character packs for ClawCaptcha. A pack is a self-contained set of prizes:
 * the catalogue (ids + display widths), a meta map (label + accent tint for
 * the challenge line) and where the PNGs are served from. The component is
 * pack-agnostic — swap the pack and the same machine grabs a different cast.
 *
 * Display widths are tuned so every prize reads at a comparable on-screen size
 * (~100px tall) whatever its source aspect ratio, with the genuinely big ones
 * (Snorlax) left a touch larger on purpose. */

import { TOY_META, type ToyId } from './toys.ts'

export interface PackItem {
  /** prize id; also the PNG filename (`<assetBase><id>.png`) */
  id: string
  /** rendered width in px inside the machine */
  w: number
}

export interface CaptchaPack {
  /** stable id, used for remount keys */
  id: string
  /** label for the pack switcher */
  label: string
  /** where this pack's PNGs live, e.g. '/toys/' */
  assetBase: string
  /** the full catalogue scattered into the pile */
  items: PackItem[]
  /** label + accent tint per prize id */
  meta: Record<string, { label: string; accent: string }>
  /** optional livery for the action button (e.g. a Pokéball for the Pokémon pack) */
  actionSkin?: 'pokeball'
}

// the original soft-vinyl cuties
const CUTE_ITEMS: Array<{ toy: ToyId; w: number }> = [
  { toy: 'duck', w: 96 },
  { toy: 'bear', w: 92 },
  { toy: 'panda', w: 86 },
  { toy: 'bunny', w: 80 },
  { toy: 'dino', w: 92 },
  { toy: 'penguin', w: 84 },
  { toy: 'fox', w: 80 },
  { toy: 'frog', w: 80 },
  { toy: 'whale', w: 90 },
  { toy: 'cat', w: 78 },
  { toy: 'puppy', w: 84 }, // lying pose: wide source art, so it needs extra width to read at size
  { toy: 'unicorn', w: 82 },
]

export const CUTE_PACK: CaptchaPack = {
  id: 'cute',
  label: 'Cuties',
  assetBase: '/toys/',
  items: CUTE_ITEMS.map((t) => ({ id: t.toy, w: t.w })),
  meta: TOY_META,
}

// the pokémon set — same soft-vinyl render style, served from /pokemon/
export const POKEMON_PACK: CaptchaPack = {
  id: 'pokemon',
  label: 'Pokémon',
  assetBase: '/pokemon/',
  actionSkin: 'pokeball',
  items: [
    { id: 'pikachu', w: 94 },
    { id: 'charmander', w: 80 },
    { id: 'squirtle', w: 78 },
    { id: 'bulbasaur', w: 82 },
    { id: 'eevee', w: 90 },
    { id: 'jigglypuff', w: 82 },
    { id: 'meowth', w: 88 },
    { id: 'psyduck', w: 76 },
    { id: 'snorlax', w: 110 },
    { id: 'togepi', w: 78 },
    { id: 'mew', w: 78 },
  ],
  meta: {
    pikachu: { label: 'Pikachu', accent: '#F2C12E' },
    charmander: { label: 'Charmander', accent: '#EF8A3C' },
    squirtle: { label: 'Squirtle', accent: '#4FA6D6' },
    bulbasaur: { label: 'Bulbasaur', accent: '#5FA86A' },
    eevee: { label: 'Eevee', accent: '#C39A6B' },
    jigglypuff: { label: 'Jigglypuff', accent: '#EE9CBE' },
    meowth: { label: 'Meowth', accent: '#D9A441' },
    psyduck: { label: 'Psyduck', accent: '#EAC24A' },
    snorlax: { label: 'Snorlax', accent: '#5A7A88' },
    togepi: { label: 'Togepi', accent: '#D9B85A' },
    mew: { label: 'Mew', accent: '#E89BBC' },
  },
}

export const PACKS: CaptchaPack[] = [CUTE_PACK, POKEMON_PACK]
