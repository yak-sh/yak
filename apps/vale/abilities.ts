// What a hero can do beyond a plain blow. Each family of weapon gives two
// abilities and what is held in the other hand one more, so a hero's
// abilities are what they carry: sword and shield cleave, lunge and block;
// staff and tome blaze, ward and mend. An ability is a row: the shape of
// what it takes, how hard it lands, what else it does, and how soon it can
// be done again. strike.ts finds what an ability takes; play.ts does it, on
// the hero's own page, the way it does a blow.
//
// The shapes: `one` lands on the creature it was aimed at, and waits for one
// in reach; an `arc` sweeps everything before the hero; a `ring` takes
// everything about them; a `burst` lands on the creature aimed at and
// everything about it; `self` takes nothing, and does its work on the hero.
import { ITEMS } from './items.ts'
import type { Worn } from './gear.ts'

export type Shape = 'one' | 'arc' | 'ring' | 'burst' | 'self'

/** How a hero moves as they do it: their weapon's own blow, a turn all the
 * way round, the other hand raised, or both hands up. */
export type Pose = 'swing' | 'spin' | 'guard' | 'cast'

export type Ability = {
  name: string
  icon: string
  /** what it does, in a few words, for the bar and the pack */
  says: string
  shape: Shape
  pose: Pose
  /** metres past the weapon's reach for `one` and `arc`; the radius of a
   * `ring` or a `burst` */
  far?: number
  /** how far either side of ahead an `arc` takes, in radians */
  arc?: number
  /** how hard it lands on each it takes, against a blow */
  dmg?: number
  /** how many times it lands on its foe, a moment apart */
  hits?: number
  /** how many shots it looses, over where it lands */
  shots?: number
  /** its last blow is always a great one */
  sure?: boolean
  /** how long what it takes is held still, unable to move or bite, in ms */
  held?: number
  /** how hard what it takes bleeds or burns over the next few seconds,
   * against a blow */
  bleed?: number
  /** how far the hero goes: at the foe before landing, or behind it */
  dash?: number
  behind?: boolean
  /** how long bites are turned aside, in ms, unless a blow lowers the guard
   * sooner */
  guard?: number
  /** a share of the hero's most health turned before any is taken, for a
   * while */
  ward?: number
  /** a share of the hero's most health back at once */
  heal?: number
  /** how long it keeps the weapon busy, in ms, when not its pace */
  time?: number
  /** ms before it can be done again */
  cool: number
  /** the colour of its dust and light, when not the dust's own */
  tint?: number
}

/** Every ability, by id. */
export let ABILITIES: Record<string, Ability> = {
  haymaker: {
    name: 'Haymaker',
    icon: '👊',
    says: 'A big swing that knocks the foe senseless for a second.',
    shape: 'one',
    pose: 'swing',
    dmg: 2,
    held: 1000,
    cool: 6000,
  },
  cleave: {
    name: 'Cleave',
    icon: '🌙',
    says: 'A wide sweep through everything in front of you.',
    shape: 'arc',
    pose: 'swing',
    far: 0.5,
    arc: 1.4,
    dmg: 1.3,
    cool: 6000,
  },
  lunge: {
    name: 'Lunge',
    icon: '⚡',
    says: 'Dash at a foe a few strides off and run it through.',
    shape: 'one',
    pose: 'swing',
    dash: 4.5,
    dmg: 2,
    cool: 9000,
  },
  whirl: {
    name: 'Whirl',
    icon: '🌀',
    says: 'Spin round, striking everything about you.',
    shape: 'ring',
    pose: 'spin',
    far: 2.8,
    dmg: 1.25,
    cool: 8000,
  },
  rend: {
    name: 'Rend',
    icon: '🩸',
    says: 'A deep cut. The foe bleeds for four seconds.',
    shape: 'one',
    pose: 'swing',
    dmg: 1.4,
    bleed: 1.6,
    cool: 10000,
    tint: 0xd8483a,
  },
  quake: {
    name: 'Quake',
    icon: '💥',
    says: 'Slam the ground. Everything about you is stunned for 2 s.',
    shape: 'ring',
    pose: 'swing',
    far: 3.4,
    dmg: 1,
    held: 2000,
    cool: 11000,
    tint: 0xb8a07a,
  },
  crush: {
    name: 'Crush',
    icon: '💢',
    says: 'One enormous overhead blow, more than twice as hard.',
    shape: 'one',
    pose: 'swing',
    dmg: 2.6,
    cool: 9000,
  },
  flurry: {
    name: 'Flurry',
    icon: '🗡️',
    says: 'Three quick stabs, the last a sure great blow.',
    shape: 'one',
    pose: 'swing',
    dmg: 0.8,
    hits: 3,
    sure: true,
    time: 600,
    cool: 6000,
  },
  shadowstep: {
    name: 'Shadowstep',
    icon: '👤',
    says: 'Step behind a foe a few strides off and stab it: a sure great blow.',
    shape: 'one',
    pose: 'swing',
    dash: 6,
    behind: true,
    dmg: 1,
    sure: true,
    cool: 10000,
    tint: 0x6a5a8a,
  },
  volley: {
    name: 'Volley',
    icon: '🌧️',
    says: 'Rain arrows on your foe and everything within 3 m of it.',
    shape: 'burst',
    pose: 'swing',
    far: 3,
    dmg: 0.9,
    shots: 6,
    cool: 8000,
  },
  pin: {
    name: 'Pinning shot',
    icon: '📌',
    says: 'An arrow that pins the foe where it stands for 3 s.',
    shape: 'one',
    pose: 'swing',
    dmg: 1.2,
    held: 3000,
    cool: 10000,
  },
  blaze: {
    name: 'Blaze',
    icon: '🔥',
    says: 'A bolt that bursts into flame on your foe and all about it.',
    shape: 'burst',
    pose: 'swing',
    far: 2.5,
    dmg: 1.4,
    cool: 7000,
    tint: 0xff8a3a,
  },
  ward: {
    name: 'Ward',
    icon: '🔮',
    says: 'A ward of light that takes the next bites for you, for 8 s.',
    shape: 'self',
    pose: 'cast',
    ward: 0.3,
    cool: 16000,
    tint: 0x9fd8ff,
  },
  block: {
    name: 'Block',
    icon: '🛡️',
    says:
      'Raise your shield: bites are turned, and leave the biter open to a great blow.',
    shape: 'self',
    pose: 'guard',
    guard: 1500,
    time: 400,
    cool: 6000,
    tint: 0xffe08a,
  },
  mend: {
    name: 'Mend',
    icon: '💚',
    says: 'Read a word of healing: a third of your health back.',
    shape: 'self',
    pose: 'cast',
    heal: 0.3,
    cool: 18000,
    tint: 0x8ff07a,
  },
  scorch: {
    name: 'Scorch',
    icon: '☄️',
    says: 'Sweep the flame before you. What it catches burns for 4 s.',
    shape: 'arc',
    pose: 'swing',
    far: 1.2,
    arc: 1,
    dmg: 0.6,
    bleed: 1.2,
    cool: 9000,
    tint: 0xff7a2a,
  },
}

/** What each family of weapon gives, and each thing held in the other hand.
 * Bare hands give one. */
export let GIVES: Record<string, string[]> = {
  fists: ['haymaker'],
  sword: ['cleave', 'lunge'],
  axe: ['whirl', 'rend'],
  hammer: ['quake', 'crush'],
  dagger: ['flurry', 'shadowstep'],
  bow: ['volley', 'pin'],
  staff: ['blaze', 'ward'],
  shield: ['block'],
  tome: ['mend'],
  torch: ['scorch'],
}

/** The abilities what a hero wears gives them, on the bar's three slots: the
 * weapon's two, then the other hand's; empty where nothing gives one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { ITEMS } from './items.ts'
 * let worn = (...kinds: string[]) =>
 *   abilitiesOf(Object.fromEntries(
 *     kinds.map((kind) => [ITEMS[kind].slot!, { eid: kind, kind, n: 1 }]),
 *   ))
 * assertEquals(worn('sword1', 'shield1'), ['cleave', 'lunge', 'block'])
 * assertEquals(worn('bow2'), ['volley', 'pin', ''])
 * assertEquals(worn('tome1'), ['haymaker', '', 'mend'])
 * // A quest's blade gives what its family gives.
 * assertEquals(worn('blade5'), ['blaze', 'ward', ''])
 * ```
 */
export let abilitiesOf = (worn: Worn): string[] => {
  let main = ITEMS[worn.main?.kind ?? '']?.family ?? ''
  let [a = '', b = ''] = GIVES[main] ?? GIVES.fists
  return [a, b, GIVES[ITEMS[worn.off?.kind ?? '']?.family ?? '']?.[0] ?? '']
}
