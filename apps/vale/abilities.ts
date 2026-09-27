// What a hero can do beyond a plain blow. Each family of weapon gives two
// abilities and what is held in the other hand one more, so a hero's
// abilities are what they carry: sword and shield cleave, lunge and block;
// staff and tome blaze, ward and mend; a dagger in each hand flurry,
// shadowstep and crosscut. An ability is a row: the shape of
// what it takes, how hard it lands, what else it does, and how soon it can
// be done again. strike.ts finds what an ability takes; play.ts does it, on
// the hero's own page, the way it does a blow.
//
// The shapes: `one` lands on the creature it was aimed at, and waits for one
// in reach; an `arc` sweeps everything before the hero; a `ring` takes
// everything about them; a `burst` lands on the creature aimed at and
// everything about it; `self` takes nothing, and does its work on the hero.
//
// What an ability says it does is written from its row as the hero does it
// (`does`): the numbers a skill changed, the damage and health their own blow
// and health make, and what a skill added to it, so it never says what it no
// longer does.
import type { Glyph } from './glyphs.ts'
import { ITEMS } from './items.ts'
import type { Worn } from './gear.ts'

export type Shape = 'one' | 'arc' | 'ring' | 'burst' | 'self'

/** How a hero moves as they do it: their weapon's own blow, a turn all the
 * way round, the other hand raised, both hands up, or both blades across the
 * foe at once. */
export type Pose = 'swing' | 'spin' | 'guard' | 'cast' | 'cross'

export type Ability = {
  name: string
  icon: Glyph
  /** what it does, as a sentence of its numbers in words (`does`) */
  says: (w: Words) => string
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
  /** a killing blow with it makes it ready again at once */
  renew?: boolean
  /** the colour of its dust and light, when not the dust's own */
  tint?: number
}

/** A bleed or a burn lands this many times, a second apart, and a ward lasts
 * this long, in ms (play.ts does them). */
export let BLEEDS = 4
export let WARD = 8000

/** Who does an ability: how hard their blow lands before the dice (rules.ts
 * `blowOf`), and the most health they can have. */
export type Doer = { blow: number; max: number }

/** An ability's numbers as a doer does it, each in words, or empty where it
 * has none: the damage of each of its blows, how far it reaches, how wide it
 * sweeps and how far it dashes, how long it holds a foe, what a bleed or a
 * burn adds, how long a guard holds, what a ward takes and for how long,
 * what it mends, and how many times it lands. */
export type Words = Record<
  | 'dmg'
  | 'far'
  | 'arc'
  | 'dash'
  | 'held'
  | 'bleed'
  | 'guard'
  | 'ward'
  | 'lasts'
  | 'heal'
  | 'hits',
  string
>

/** A span in ms, as a person reads it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([1500, 18000, 8000].map(secs), ['1.5 s', '18 s', '8 s'])
 * ```
 */
export let secs = (ms: number): string => `${+(ms / 1000).toFixed(1)} s`

let words = (a: Ability, { blow, max }: Doer): Words => ({
  dmg: a.dmg ? `${Math.round(blow * a.dmg)} damage` : '',
  far: a.far ? `${a.far} m` : '',
  arc: a.arc ? `${Math.round((a.arc * 360) / Math.PI)}°` : '',
  dash: a.dash ? `${a.dash} m` : '',
  held: a.held ? secs(a.held) : '',
  bleed: a.bleed
    ? `${Math.round((blow * a.bleed) / BLEEDS) * BLEEDS} more over ${
      secs(BLEEDS * 1000)
    }`
    : '',
  guard: a.guard ? secs(a.guard) : '',
  ward: a.ward ? `${Math.round(max * a.ward)} damage` : '',
  lasts: secs(WARD),
  heal: a.heal ? `${Math.round(max * a.heal)} health` : '',
  hits: String(a.hits ?? 1),
})

/** What `a` does, done by `d`, with its numbers, and what else a skill made
 * it do: pass the ability as their skills make it (skills.ts `formOf`).
 *
 * ```ts
 * import { assertEquals, assertMatch, assertNotMatch } from '@std/assert'
 * import { formOf } from './skills.ts'
 * let d = { blow: 20, max: 120 }
 * assertEquals(does(ABILITIES.mend, d), 'Read a word of healing: 36 health back.')
 * // Kindness mends nearer half, and Mend says so.
 * assertEquals(does(formOf('mend', ['kindness'])!, d), 'Read a word of healing: 54 health back.')
 * assertEquals(
 *   does(ABILITIES.rend, d),
 *   'A deep cut for 28 damage. The foe bleeds 32 more over 4 s.',
 * )
 * // Earthbreaker's Crush leaves the foe senseless; the plain one does not.
 * assertEquals(does(ABILITIES.crush, d), 'One enormous overhead blow for 52 damage.')
 * assertEquals(
 *   does(formOf('crush', ['earthbreaker'])!, d),
 *   'One enormous overhead blow for 64 damage, and the foe is senseless for 1.5 s.',
 * )
 * // Relentless readies a Lunge that kills, and Lunge says so.
 * assertNotMatch(does(ABILITIES.lunge, d), /kill/)
 * assertMatch(does(formOf('lunge', ['relentless'])!, d), /killing blow/)
 * ```
 */
export let does = (a: Ability, d: Doer): string =>
  a.says(words(a, d)) +
  (a.renew ? ' Ready again at once after a killing blow.' : '')

/** Every ability, by id. */
export let ABILITIES: Record<string, Ability> = {
  haymaker: {
    name: 'Haymaker',
    icon: 'handFist',
    says: (w) =>
      `A big swing for ${w.dmg} that knocks the foe senseless for ${w.held}.`,
    shape: 'one',
    pose: 'swing',
    dmg: 2,
    held: 1000,
    cool: 6000,
  },
  cleave: {
    name: 'Cleave',
    icon: 'axe',
    says: (w) =>
      `A sweep ${w.arc} wide, for ${w.dmg} on everything in front of you.`,
    shape: 'arc',
    pose: 'swing',
    far: 0.5,
    arc: 1.4,
    dmg: 1.3,
    cool: 6000,
  },
  lunge: {
    name: 'Lunge',
    icon: 'zap',
    says: (w) =>
      `Dash at a foe up to ${w.dash} off and run it through for ${w.dmg}.`,
    shape: 'one',
    pose: 'swing',
    dash: 4.5,
    dmg: 2,
    cool: 9000,
  },
  whirl: {
    name: 'Whirl',
    icon: 'tornado',
    says: (w) =>
      `Spin round, striking everything within ${w.far} of you for ${w.dmg}.`,
    shape: 'ring',
    pose: 'spin',
    far: 2.8,
    dmg: 1.25,
    cool: 8000,
  },
  rend: {
    name: 'Rend',
    icon: 'droplet',
    says: (w) => `A deep cut for ${w.dmg}. The foe bleeds ${w.bleed}.`,
    shape: 'one',
    pose: 'swing',
    dmg: 1.4,
    bleed: 1.6,
    cool: 10000,
    tint: 0xd8483a,
  },
  quake: {
    name: 'Quake',
    icon: 'activity',
    says: (w) =>
      `Slam the ground: everything within ${w.far} of you takes ${w.dmg}, and is stunned for ${w.held}.`,
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
    icon: 'hammer',
    says: (w) =>
      `One enormous overhead blow for ${w.dmg}${
        w.held ? `, and the foe is senseless for ${w.held}` : ''
      }.`,
    shape: 'one',
    pose: 'swing',
    dmg: 2.6,
    cool: 9000,
  },
  flurry: {
    name: 'Flurry',
    icon: 'blow',
    says: (w) =>
      `${w.hits} quick stabs for ${w.dmg} each, the last a sure great blow.`,
    shape: 'one',
    pose: 'swing',
    dmg: 0.8,
    hits: 3,
    sure: true,
    time: 600,
    cool: 6000,
  },
  crosscut: {
    name: 'Crosscut',
    icon: 'scissors',
    says: (w) =>
      `Both daggers across the foe at once: ${w.hits} cuts for ${w.dmg} each, and it bleeds ${w.bleed}.`,
    shape: 'one',
    pose: 'cross',
    dmg: 0.9,
    hits: 2,
    bleed: 1.2,
    time: 450,
    cool: 8000,
    tint: 0xd8483a,
  },
  shadowstep: {
    name: 'Shadowstep',
    icon: 'mask',
    says: (w) =>
      `Step behind a foe up to ${w.dash} off and stab it for ${w.dmg}: a sure great blow.`,
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
    icon: 'cloudRain',
    says: (w) =>
      `Rain arrows on your foe and everything within ${w.far} of it, for ${w.dmg}.`,
    shape: 'burst',
    pose: 'swing',
    far: 3,
    dmg: 0.9,
    shots: 6,
    cool: 8000,
  },
  pin: {
    name: 'Pinning shot',
    icon: 'locateFixed',
    says: (w) =>
      `An arrow for ${w.dmg} that pins the foe where it stands for ${w.held}.`,
    shape: 'one',
    pose: 'swing',
    dmg: 1.2,
    held: 3000,
    cool: 10000,
  },
  blaze: {
    name: 'Blaze',
    icon: 'flame',
    says: (w) =>
      `A bolt that bursts into flame on your foe and everything within ${w.far} of it, for ${w.dmg}.`,
    shape: 'burst',
    pose: 'swing',
    far: 2.5,
    dmg: 1.4,
    cool: 7000,
    tint: 0xff8a3a,
  },
  ward: {
    name: 'Ward',
    icon: 'shieldCheck',
    says: (w) =>
      `A ward of light that takes the next ${w.ward} of bites for you, for up to ${w.lasts}.`,
    shape: 'self',
    pose: 'cast',
    ward: 0.3,
    cool: 16000,
    tint: 0x9fd8ff,
  },
  block: {
    name: 'Block',
    icon: 'shield',
    says: (w) =>
      `Raise your shield for ${w.guard}: bites are turned, and leave the biter open to a great blow.`,
    shape: 'self',
    pose: 'guard',
    guard: 1500,
    time: 400,
    cool: 6000,
    tint: 0xffe08a,
  },
  mend: {
    name: 'Mend',
    icon: 'handHeart',
    says: (w) => `Read a word of healing: ${w.heal} back.`,
    shape: 'self',
    pose: 'cast',
    heal: 0.3,
    cool: 18000,
    tint: 0x8ff07a,
  },
  scorch: {
    name: 'Scorch',
    icon: 'flameKindling',
    says: (w) =>
      `Sweep the flame ${w.arc} wide before you, for ${w.dmg}. What it catches burns ${w.bleed}.`,
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

/** What each family of weapon gives in the hand. Bare hands give one. */
export let GIVES: Record<string, string[]> = {
  fists: ['haymaker'],
  sword: ['cleave', 'lunge'],
  axe: ['whirl', 'rend'],
  hammer: ['quake', 'crush'],
  dagger: ['flurry', 'shadowstep'],
  bow: ['volley', 'pin'],
  staff: ['blaze', 'ward'],
}

/** What each thing held in the other hand gives: a shield, a tome, a torch,
 * or a second dagger beside the first (skills.ts `hand`). */
export let OFF: Record<string, string> = {
  shield: 'block',
  tome: 'mend',
  torch: 'scorch',
  dagger: 'crosscut',
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
 * // A dagger in each hand: the second gives its own.
 * assertEquals(
 *   abilitiesOf({
 *     main: { eid: 'a', kind: 'dagger2', n: 1 },
 *     off: { eid: 'b', kind: 'dagger1', n: 1 },
 *   }),
 *   ['flurry', 'shadowstep', 'crosscut'],
 * )
 * ```
 */
export let abilitiesOf = (worn: Worn): string[] => {
  let main = ITEMS[worn.main?.kind ?? '']?.family ?? ''
  let [a = '', b = ''] = GIVES[main] ?? GIVES.fists
  return [a, b, OFF[ITEMS[worn.off?.kind ?? '']?.family ?? ''] ?? '']
}
