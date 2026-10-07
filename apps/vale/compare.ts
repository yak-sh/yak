// The shared gear display: an item's named stats, the hero's resulting
// numbers with a piece equipped, and current-to-result comparisons, each a
// line of ValeStats. A number that would change reads from what it is to
// what it would be, the new one Better or Worse; nothing else is coloured.
// The bag, comparison tip, crafting station, skills and character sheet use
// these names.
import { type ComponentChildren, h, type JSX } from 'preact'
import { Section, Tile } from '@yaks/ui'
import type { Doer } from './abilities.ts'
import { type Slot, sortOf, tierName } from './arms.ts'
import { hands, kitOf, twins, type Worn } from './gear.ts'
import { type Glyph, glyph } from './glyphs.ts'
import { ITEMS } from './items.ts'
import { ValeStats } from './kit/ValeStats.ts'
import type { Sheet } from './play.ts'
import { GEAR_STATS, GRADES, type Piece, type Stat, tint } from './rarity.ts'
import { blowOf, type Held, maxHp } from './rules.ts'
import { skilled } from './skills.ts'
import { icon } from './sprites.ts'
import { part, picture } from './tile.ts'

type Hero = Pick<Sheet, 'lvl' | 'learned'>

// What a hero would fight with wearing `worn`, with their level and skills.
let kitWith = ({ lvl, learned }: Hero, worn: Worn) =>
  skilled(kitOf(worn), learned, maxHp(lvl))

/** Who would do an ability wearing `worn`: the blow and the health it would
 * give them (abilities.ts `does`). */
export let doer = (s: Hero, worn: Worn): Doer => {
  let k = kitWith(s, worn)
  return { blow: blowOf(s.lvl, k), max: maxHp(s.lvl) + k.hp }
}

/** What a hero would do wearing `worn`, with their level and skills, in the
 * numbers a sheet shows. */
export let numbers = (s: Hero, worn: Worn) => {
  let k = kitWith(s, worn)
  let blow = (dmg: number) => Math.round(blowOf(s.lvl, k, dmg))
  return {
    blow: blow(k.dmg),
    twin: k.twin ? blow(k.twin) : 0,
    pace: k.pace / 1000,
    reach: k.reach,
    armour: k.armour,
    hp: maxHp(s.lvl) + k.hp,
    speed: Math.round(k.speed * 100),
    luck: Math.round((0.12 + k.luck) * 100),
  }
}
export type Numbers = ReturnType<typeof numbers>

/** The shared names for every stat on an item. Weapon power multiplies the
 * hero's level-based attack, so it never reads as a flat Attack bonus. */
export let statName = (s: Stat | 'dmg'): string =>
  ({
    dmg: 'Weapon power',
    force: 'Attack bonus',
    luck: 'Critical chance',
    hp: 'Health',
    armour: 'Armor',
    speed: 'Speed',
    haste: 'Attack speed bonus',
  })[s]

/** A number on the hero's sheet, with its name and display unit. */
export type Line = {
  k: keyof Numbers
  name: string
  icon: Glyph
  shows: (n: number) => string
  more: boolean
}

/** Each number a sheet shows. */
export let LINES: Line[] = [
  { k: 'blow', name: 'Attack', icon: 'blow', shows: String, more: true },
  {
    k: 'twin',
    name: 'Off-hand Attack',
    icon: 'blow',
    shows: String,
    more: true,
  },
  {
    k: 'pace',
    name: 'Attack interval',
    icon: 'pace',
    shows: (n) => `${n.toFixed(2)} s`,
    more: false,
  },
  {
    k: 'reach',
    name: 'Reach',
    icon: 'reach',
    shows: (n) => `${n} m`,
    more: true,
  },
  {
    k: 'armour',
    name: statName('armour'),
    icon: 'armour',
    shows: String,
    more: true,
  },
  { k: 'hp', name: statName('hp'), icon: 'health', shows: String, more: true },
  {
    k: 'speed',
    name: statName('speed'),
    icon: 'footprints',
    shows: (n) => `${n}%`,
    more: true,
  },
  {
    k: 'luck',
    name: statName('luck'),
    icon: 'luck',
    shows: (n) => `${n}%`,
    more: true,
  },
]

// A named stat's icon, shared by gear, skills and their possible rolls.
let statIcon = (stat: Stat | 'dmg'): Glyph =>
  ({
    dmg: 'blow',
    force: 'blow',
    haste: 'pace',
    armour: 'armour',
    hp: 'health',
    speed: 'footprints',
    luck: 'luck',
  } as const)[stat]

/** A hero's number, read in its line.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let pace = LINES.find((l) => l.k == 'pace')!
 * assertEquals(said(pace, 0.5).endsWith('0.50 s Attack interval'), true)
 * ```
 */
export let said = (l: Line, n: number): string => `${l.shows(n)} ${l.name}`

/** What the hero would wear with `held` put on in `slot`, its own unless
 * said (gear.ts `hands`): a weapon for both hands empties the other, a thing
 * for the other hand drops one, and a new weapon drops a second blade that is
 * no longer its twin. */
export let trying = (
  worn: Worn,
  held: Held,
  slot = ITEMS[held.kind]?.slot,
): Worn =>
  slot ? hands({ ...worn, [slot]: held }, slot == 'off' ? 'off' : 'main') : worn

/** What the hero would wear with a slot taken off. */
export let bare = (worn: Worn, slot: string): Worn =>
  Object.fromEntries(Object.entries(worn).filter(([s]) => s != slot))

/** Where a thing taken up goes: a second blade the hero knows how to hold in
 * the other hand goes there (gear.ts `twins`), anything else in its slot. */
export let into = (s: Sheet, kind: string): Slot | undefined =>
  twins(kind, s.worn, s.learned) ? 'off' : ITEMS[kind]?.slot

/** One line of numbers: its icon, then its words. */
export let stat = (
  mark: Glyph,
  ...words: ComponentChildren[]
): JSX.Element =>
  h(
    ValeStats.Stat,
    {},
    h(ValeStats.Mark, {
      'aria-hidden': 'true',
      dangerouslySetInnerHTML: { __html: glyph(mark) },
    }),
    h(ValeStats.Words, {}, ...words),
  )

/** Lines of numbers, in two columns where there is room for them. */
export let stats = (lines: ComponentChildren, two = false): JSX.Element =>
  h(ValeStats, { mod: two && 'two' }, lines)

// Which way a number going from `a` to `b` goes, where it moves: the better
// way (more of it, or less where less is better) or the worse.
let way = (more: boolean, a: number, b: number) =>
  a == b ? null : (more ? b > a : b < a) ? ValeStats.Better : ValeStats.Worse

/** `text`, saying the number `b` that `a` would become, Better or Worse as
 * it goes, and ink where it stays.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h } from 'preact'
 * import { renderToString } from 'preact-render-to-string'
 * let read = (more: boolean, a: number, b: number) =>
 *   renderToString(h('b', {}, toward(more, a, b, String(b))))
 * assertEquals(read(true, 1, 2), '<b><em class="ValeStats_Better">2</em></b>')
 * assertEquals(read(false, 1, 2), '<b><em class="ValeStats_Worse">2</em></b>')
 * assertEquals(read(true, 2, 2), '<b>2</b>')
 * ```
 */
export let toward = (
  more: boolean,
  a: number,
  b: number,
  text: string,
): ComponentChildren => {
  let to = way(more, a, b)
  return to ? h(to, {}, text) : text
}

/** A range carries its shared unit once and its positive sign once. */
export let rangeText = (a: string, b: string): string => {
  if (a == b) return a
  let unit = a.match(/(?:%|×| s| m)$/)?.[0]
  if (unit && b.endsWith(unit)) a = a.slice(0, -unit.length)
  return `${a}-${b.replace(/^\+/, '')}`
}

// Whether every number reads as the first does.
let stays = (shows: (n: number) => string, ...ns: number[]) =>
  ns.every((n) => shows(n) == shows(ns[0]))

/** What `now` may become, from `low` to `high`, as `rangeText` writes it:
 * Better or Worse where all of it goes that way, and ink where it may read
 * as it does now, or go either way. */
export let toRange = (
  more: boolean,
  now: number,
  low: number,
  high: number,
  shows: (n: number) => string,
): ComponentChildren => {
  let text = rangeText(shows(low), shows(high))
  let [a, b] = [low, high].map((n) =>
    stays(shows, now, n) ? null : way(more, now, n)
  )
  return a && a == b ? h(a, {}, text) : text
}

/** Each line where `b` differs from `a`: from `a`'s number to `b`'s. */
export let moved = (a: Numbers, b: Numbers): JSX.Element[] =>
  LINES.filter((l) => !stays(l.shows, a[l.k], b[l.k])).map((l) =>
    stat(
      l.icon,
      `${l.name} ${l.shows(a[l.k])} → `,
      toward(l.more, a[l.k], b[l.k], l.shows(b[l.k])),
    )
  )

/** The hero's numbers, each a line in ink. */
export let sheetStats = (n: Numbers, lines: Line[] = LINES): JSX.Element[] =>
  lines.map((l) => stat(l.icon, said(l, n[l.k])))

export let statValue = (s: Stat | 'dmg', n: number): string =>
  s == 'dmg'
    ? `${n}×`
    : s == 'force' || s == 'luck' || s == 'speed' || s == 'haste'
    ? `${n < 0 ? '' : '+'}${(n * 100).toFixed(1).replace(/\.0$/, '')}%`
    : `${n < 0 ? '' : '+'}${n}`

/** Possible item rolls, written just as a finished item's stat is. */
export let statRangeValue = (
  stat: Stat | 'dmg',
  low: number,
  high: number,
): string => rangeText(statValue(stat, low), statValue(stat, high))

/** One named stat with its icon, a piece's own or a skill's, in ink. */
export let statLine = (s: Stat | 'dmg', value: string): JSX.Element =>
  stat(statIcon(s), `${value} ${statName(s)}`)

/** A named stat from `now` to what it may become, from `low` to `high`. */
export let statStep = (
  s: Stat | 'dmg',
  now: number,
  low: number,
  high = low,
): JSX.Element =>
  stat(
    statIcon(s),
    `${statName(s)} ${statValue(s, now)} → `,
    toRange(true, now, low, high, (n) => statValue(s, n)),
  )

/** Every number the item itself grants, including its rolled bonuses, and
 * a legendary's power. */
export let itemStats = (p: Piece): JSX.Element[] => [
  ...GEAR_STATS.filter((st) => p[st]).map((st) =>
    statLine(st, statValue(st, p[st]!))
  ),
  ...(p.legend
    ? [
      stat(
        p.legend.icon,
        h('i', { class: `Rarity ${tint('legendary')}` }, p.legend.says),
      ),
    ]
    : []),
]

/** What sort of thing a piece of gear is, with its item level first. */
export let sortLine = (t: Piece): string =>
  `${t.lvl == null ? '' : `Level ${t.lvl} · `}${
    t.rarity == 'common' ? '' : `${GRADES[t.rarity].name} · `
  }${sortOf(t)}${t.tier ? ` · tier ${tierName(t.tier)}` : ''}`

/** A piece as a tile (packages/ui/Tile.ts): its picture framed and its name
 * set in its rarity, then the `Sub` and `End` given. */
export let pieceTile = (
  p: Piece,
  props: Record<string, unknown>,
  ...rest: ComponentChildren[]
): JSX.Element =>
  h(
    Tile,
    props,
    picture(icon(p.kind) || '•', { class: tint(p.rarity) }),
    h(Tile.Title, { class: `Rarity ${tint(p.rarity)}` }, p.name),
    ...rest,
  )

/** One side of a comparison: what it is called there, its piece if it has
 * one, and what the hero would wear with it. */
export type Side = { label: string; p?: Piece; worn: Worn }

// A side's piece: what it is called there, the piece, and its own stats.
let side = ({ label, p }: Omit<Side, 'worn'>) =>
  part(
    label,
    p
      ? [
        pieceTile(p, {}, h(Tile.Sub, {}, sortLine(p))),
        stats(itemStats(p)),
      ]
      : h(Section.Sub, {}, 'Nothing'),
  )

/** Under `title`, how the hero's numbers would go from `a` to `b`, or that
 * none would change. */
export let changes = (
  title: string,
  a: Numbers,
  b: Numbers,
  none = 'No listed stats change.',
): JSX.Element => {
  let lines = moved(a, b)
  return part(
    title,
    lines.length ? stats(lines, true) : h(Section.Sub, {}, none),
  )
}

// A comparison's card, in a tip: its sides side by side, or `one` column.
let card = (one: boolean, ...kids: ComponentChildren[]) =>
  h('div', { class: one ? 'Compare Compare-one' : 'Compare' }, ...kids)

/** A piece on its own, as a card. */
export let solo = (label: string, p: Piece): JSX.Element =>
  card(true, side({ label, p }))

/** Candidate and worn pieces, followed by the hero's resulting changes.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { renderToString } from 'preact-render-to-string'
 * import { seedItems } from './items_fixture.ts'
 * import { piece } from './rarity.ts'
 * import type { Side } from './compare.ts'
 * seedItems()
 * let hero = { lvl: 3, learned: [] }
 * let h = { eid: 'a', kind: 'helm2', n: 1 }
 * let bag = { label: 'In your bag', p: piece(h), worn: { head: h } }
 * let bare = { label: 'Worn', worn: {} }
 * let read = (a: Side, b: Side) => renderToString(versus(hero, a, b))
 * assertEquals(read(bag, bare).includes('Better'), true)
 * assertEquals(read(bag, bare).includes('Worse'), false)
 * assertEquals(read(bare, bag).includes('Better'), false)
 * assertEquals(read(bag, bag).includes('No listed stats change'), true)
 * ```
 */
export let versus = (s: Hero, then: Side, now: Side): JSX.Element =>
  card(
    false,
    side(then),
    side(now),
    changes('If equipped', numbers(s, now.worn), numbers(s, then.worn)),
  )

/** What a piece's next upgrade may make of it, from `low` to `high`: its
 * own stats, then the hero's numbers, through the same worn gear as a
 * finished upgrade, each from now to what it may become. */
export let stepRange = (
  s: Hero,
  now: Side,
  low: Side,
  high: Side,
): JSX.Element[] => {
  let at = `now → at +${low.p?.plus ?? 0}`
  let own = GEAR_STATS.flatMap((st) => {
    let [a, b, c] = [now, low, high].map((x) => x.p?.[st] ?? 0)
    return stays((n) => statValue(st, n), a, b, c)
      ? []
      : [statStep(st, a, b, c)]
  })
  let [a, b, c] = [now, low, high].map((x) => numbers(s, x.worn))
  let yours = LINES.flatMap((l) => {
    let [x, y, z] = [a, b, c].map((n) => n[l.k])
    return stays(l.shows, x, y, z) ? [] : [
      stat(
        l.icon,
        `${l.name} ${l.shows(x)} → `,
        toRange(l.more, x, y, z, l.shows),
      ),
    ]
  })
  let titled = (title: string) => [title, h(Section.Note, {}, at)]
  return [
    ...(own.length ? [part(titled('Item stats'), stats(own))] : []),
    ...(yours.length ? [part(titled('If equipped'), stats(yours, true))] : []),
  ]
}

/** A piece, and what its next upgrade may make of it, as a card. */
export let step = (s: Hero, now: Side, low: Side, high: Side): JSX.Element =>
  card(true, side(now), ...stepRange(s, now, low, high))
