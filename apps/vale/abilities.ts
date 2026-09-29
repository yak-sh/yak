// What a hero can do beyond a plain blow. Each family of weapon gives two
// abilities and what is held in the other hand one more, so a hero's
// abilities are what they carry: sword and shield cleave, lunge and block;
// staff and tome blaze, ward and mend; a dagger in each hand flurry,
// shadowstep and crosscut. An ability is a row: the shape of
// what it takes, how hard it lands, what else it does, and how soon it can
// be done again. The authored rows live in seed/abilities/ and each page
// watches them in the store. strike.ts finds what an ability takes; play.ts
// does it, on the hero's own page, the way it does a blow.
//
// The shapes: `one` lands on the creature it was aimed at, and waits for one
// in reach; an `arc` sweeps everything before the hero; a `ring` takes
// everything about them; a `burst` lands on the creature aimed at and
// everything about it; `self` takes nothing, and does its work on the hero.
//
// Its short description comes from the row; its effects are named from the
// current numbers (`does`), including what a skill changed.
import { comp, str } from './bundle.ts'
import { type Effect, effect } from './ability-effects.ts'
import type { Glyph } from './glyphs.ts'
import { ITEMS } from './items.ts'
import type { Worn } from './gear.ts'
import type { Bundle } from './net.ts'

export type Shape = 'one' | 'arc' | 'ring' | 'burst' | 'self'

/** How a hero moves as they do it: their weapon's own blow, a turn all the
 * way round, the other hand raised, both hands up, or both blades across the
 * foe at once. */
export type Pose = 'swing' | 'spin' | 'guard' | 'cast' | 'cross'

export type SpellElement = 'fire' | 'earth' | 'shadow' | 'light' | 'life'

export type Ability = {
  /** The visual language of this ability's cast and landing. */
  element?: SpellElement
  name: string
  icon: Glyph
  /** A short description of the move, without stats; `does` adds its effects. */
  description: string
  /** Which held item grants it, and its position on that item's bar. */
  weapon?: string
  slot?: number
  offhand?: string
  shape: Shape
  pose: Pose
  /** metres past the weapon's reach for `one` and `arc`; the radius of a
   * `ring` or a `burst` */
  far?: number
  /** how far either side of ahead an `arc` takes, in radians */
  arc?: number
  /** how many shots it looses, over where it lands */
  shots?: number
  /** What happens to the hero or to each creature the shape takes. */
  effects: Effect[]
  /** how long it keeps the weapon busy, in ms, when not its pace */
  time?: number
  /** ms before it can be done again */
  cool: number
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

/** A span in ms, as a person reads it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([1500, 18000, 8000].map(secs), ['1.5 s', '18 s', '8 s'])
 * ```
 */
export let secs = (ms: number): string => `${+(ms / 1000).toFixed(1)} s`

/** What `a` does, done by `d`, with its numbers, and what else a skill made
 * it do: pass the ability as their skills make it (skills.ts `formOf`).
 *
 * ```ts
 * import { assertEquals, assertMatch, assertNotMatch } from '@std/assert'
 * import { seedAbilities } from './abilities_fixture.ts'
 * import { formOf } from './skills.ts'
 * seedAbilities()
 * let d = { blow: 20, max: 120 }
 * assertEquals(does(ABILITIES.mend, d), 'Read a word of healing. Restores 36 Health.')
 * // Kindness mends nearer half, and Mend says so.
 * assertEquals(does(formOf('mend', ['kindness'])!, d), 'Read a word of healing. Restores 54 Health.')
 * assertEquals(
 *   does(ABILITIES.rend, d),
 *   'A deep cut. 28 Damage · 32 Bleed Damage over 4 s.',
 * )
 * // Earthbreaker's Crush leaves the foe senseless; the plain one does not.
 * assertEquals(does(ABILITIES.crush, d), 'An enormous overhead blow. 52 Damage.')
 * assertEquals(
 *   does(formOf('crush', ['earthbreaker'])!, d),
 *   'An enormous overhead blow. 64 Damage · 1.5 s Stun.',
 * )
 * // A Lunge that misses is given back, and Relentless readies one that
 * // kills; Lunge says so.
 * assertNotMatch(does(ABILITIES.lunge, d), /kill/)
 * assertMatch(does(ABILITIES.lunge, d), /misses/)
 * assertMatch(does(formOf('lunge', ['relentless'])!, d), /killing blow/)
 * assertNotMatch(does(ABILITIES.crush, d), /again/)
 * ```
 */
export let does = (a: Ability, d: Doer): string => {
  let damage = effect(a.effects, 'damage')
  let bleed = effect(a.effects, 'bleed')
  let stun = effect(a.effects, 'stun')
  let dash = effect(a.effects, 'dash')
  let guard = effect(a.effects, 'guard')
  let ward = effect(a.effects, 'ward')
  let heal = effect(a.effects, 'heal')
  let when = [
    effect(a.effects, 'renew') && 'after a killing blow',
    effect(a.effects, 'refund') && 'if it misses',
  ]
    .filter(Boolean)
  let effects = [
    damage?.hits && damage.hits > 1 ? `${damage.hits} hits` : '',
    damage
      ? `${Math.round(d.blow * damage.scale)} Damage${
        damage.hits && damage.hits > 1 ? ' each' : ''
      }`
      : '',
    a.arc ? `${Math.round((a.arc * 360) / Math.PI)}° arc` : '',
    a.far
      ? a.shape == 'ring' || a.shape == 'burst'
        ? `${a.far} m radius`
        : `Extends reach by ${a.far} m`
      : '',
    dash ? `${dash.metres} m dash` : '',
    stun ? `${secs(stun.ms)} Stun` : '',
    bleed
      ? `${Math.round((d.blow * bleed.scale) / BLEEDS) * BLEEDS} ${
        a.element == 'fire' ? 'Burn' : 'Bleed'
      } Damage over ${secs(BLEEDS * 1000)}`
      : '',
    guard ? `${secs(guard.ms)} Guard` : '',
    ward
      ? `Absorbs ${Math.round(d.max * ward.share)} Damage for ${secs(WARD)}`
      : '',
    heal ? `Restores ${Math.round(d.max * heal.share)} Health` : '',
    damage?.sure
      ? damage.hits && damage.hits > 1
        ? 'Final hit is a great blow'
        : 'Always a great blow'
      : '',
  ].filter(Boolean)
  let intro = (a.description?.trim() || a.name).replace(/[.!?]+$/, '')
  return `${intro}.${effects.length ? ` ${effects.join(' · ')}.` : ''}` +
    (when.length ? ` Ready again at once ${when.join(', or ')}.` : '')
}

/** How an ability's blow went, as far as its cooldown cares: it felled what
 * it struck, or it took nothing it was aimed at. */
export type Went = 'kill' | 'miss'

/** Whether an ability is ready again at once, as its blow went: after a
 * killing blow, one a skill renews (`renew`); after a miss, one that gives
 * its cooldown back (`refund`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { changed } from './ability-effects.ts'
 * import { seedAbilities } from './abilities_fixture.ts'
 * seedAbilities()
 * let a = ABILITIES.crush
 * let went = (b: Ability) => [again(b, 'kill'), again(b, 'miss')]
 * assertEquals(went(a), [false, false])
 * assertEquals(went({ ...a, effects: changed(a.effects, [{ kind: 'renew' }]) }), [true, false])
 * assertEquals(went({ ...a, effects: changed(a.effects, [{ kind: 'refund' }]) }), [false, true])
 * ```
 */
export let again = (a: Ability, went: Went): boolean =>
  !!effect(a.effects, went == 'kill' ? 'renew' : 'refund')

// All page consumers read the same current Store design index. A watch
// replaces it, so new abilities and changes to existing ones take effect.
export let ABILITIES: Record<string, Ability> = {}
export let GIVES: Record<string, string[]> = {}
export let OFF: Record<string, string> = {}

/** Install the store's current ability designs and their equipment grants. */
export let useAbilities = (rows: Bundle[]) => {
  let next = Object.fromEntries(rows.flatMap((row) => {
    let design = comp(row, 'ability_design'), kind = str(design.kind)
    let ability = Object.fromEntries(
      Object.entries(design).filter(([, value]) => value != null),
    ) as Ability
    return kind ? [[kind, ability]] : []
  })) as Record<string, Ability>
  ABILITIES = next
  GIVES = {}
  OFF = {}
  for (let [kind, ability] of Object.entries(ABILITIES)) {
    if (ability.weapon && ability.slot) {
      let granted = GIVES[ability.weapon] ??= []
      granted[ability.slot - 1] = kind
    }
    if (ability.offhand) OFF[ability.offhand] = kind
  }
}

/** The abilities what a hero wears gives them, on the bar's three slots: the
 * weapon's two, then the other hand's; empty where nothing gives one.
 *
 * ```ts
 * import { seedItems } from './items_fixture.ts'
 * import { seedAbilities } from './abilities_fixture.ts'
 * seedItems()
 * seedAbilities()
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
