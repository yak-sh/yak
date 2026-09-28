// The shared gear display: an item's named stats, the hero's resulting
// numbers with a piece equipped, and current-to-result comparisons. The bag,
// comparison tip, crafting station, and character sheet use these names.
import type { Doer } from './abilities.ts'
import { type Slot, sortOf, tierName } from './arms.ts'
import { hands, kitOf, twins, type Worn } from './gear.ts'
import { glyphText } from './glyphs.ts'
import { ITEMS } from './items.ts'
import type { Sheet } from './play.ts'
import { GEAR_STATS, GRADES, type Piece, type Stat, tint } from './rarity.ts'
import { blowOf, type Held, maxHp } from './rules.ts'
import { skilled } from './skills.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

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
  shows: (n: number) => string
  more: boolean
}

/** Each number a sheet shows. */
export let LINES: Line[] = [
  { k: 'blow', name: 'Attack', shows: String, more: true },
  {
    k: 'twin',
    name: 'Off-hand Attack',
    shows: String,
    more: true,
  },
  {
    k: 'pace',
    name: 'Attack interval',
    shows: (n) => `${n.toFixed(2)} s`,
    more: false,
  },
  {
    k: 'reach',
    name: 'Reach',
    shows: (n) => `${n} m`,
    more: true,
  },
  {
    k: 'armour',
    name: statName('armour'),
    shows: String,
    more: true,
  },
  { k: 'hp', name: statName('hp'), shows: String, more: true },
  {
    k: 'speed',
    name: statName('speed'),
    shows: (n) => `${n}%`,
    more: true,
  },
  {
    k: 'luck',
    name: statName('luck'),
    shows: (n) => `${n}%`,
    more: true,
  },
]

/** A hero's number, read in its line.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let pace = LINES.find((l) => l.k == 'pace')!
 * assertEquals(said(pace, 0.5).endsWith('0.50 s Attack interval'), true)
 * ```
 */
export let said = (l: Line, n: number): string => `${l.shows(n)} ${l.name}`

// Green where going from `a` to `b` is better, red where it is worse.
let better = (more: boolean, a: number, b: number) =>
  (more ? b > a : b < a) ? 'Pack_Up' : 'Pack_Down'

/** What the hero would wear with `h` put on in `slot`, its own unless said
 * (gear.ts `hands`): a weapon for both hands empties the other, a thing for
 * the other hand drops one, and a new weapon drops a second blade that is no
 * longer its twin. */
export let trying = (worn: Worn, h: Held, slot = ITEMS[h.kind]?.slot): Worn =>
  slot ? hands({ ...worn, [slot]: h }, slot == 'off' ? 'off' : 'main') : worn

/** What the hero would wear with a slot taken off. */
export let bare = (worn: Worn, slot: string): Worn =>
  Object.fromEntries(Object.entries(worn).filter(([s]) => s != slot))

/** Where a thing taken up goes: a second blade the hero knows how to hold in
 * the other hand goes there (gear.ts `twins`), anything else in its slot. */
export let into = (s: Sheet, kind: string): Slot | undefined =>
  twins(kind, s.worn, s.learned) ? 'off' : ITEMS[kind]?.slot

// A number from what it is to what it would be, the new one in green where
// that is better and red where it is worse.
let arrow = (x: string, y: string, more: boolean, a: number, b: number) =>
  `${x} → <em class="${better(more, a, b)}">${y}</em>`

/** Each line where `b` differs from `a`: from `a`'s number to `b`'s. */
export let moved = (a: Numbers, b: Numbers): string =>
  LINES.filter((l) => a[l.k] != b[l.k]).map((l) =>
    `<span class=Pack_Num>${l.name} ${
      arrow(l.shows(a[l.k]), l.shows(b[l.k]), l.more, a[l.k], b[l.k])
    }</span>`
  ).join('')

export let statValue = (s: Stat | 'dmg', n: number): string =>
  s == 'dmg'
    ? `${n}×`
    : s == 'force' || s == 'luck' || s == 'speed' || s == 'haste'
    ? `${n < 0 ? '' : '+'}${(n * 100).toFixed(1).replace(/\.0$/, '')}%`
    : `${n < 0 ? '' : '+'}${n}`

/** Every number the item itself grants, including its rolled bonuses. */
export let itemStats = (p: Piece): string =>
  GEAR_STATS.filter((st) => p[st]).map((st) =>
    `<span class=Pack_Num>${statValue(st, p[st]!)} ${statName(st)}</span>`
  ).join('') +
  (p.legend
    ? `<span class=Pack_Legend>${glyphText(p.legend.icon)} ${
      esc(p.legend.says)
    }</span>`
    : '')

/** What sort of thing a piece of gear is, with its item level first. */
export let sortLine = (t: Piece): string =>
  `${t.lvl == null ? '' : `Level ${t.lvl} · `}${
    t.rarity == 'common' ? '' : `${GRADES[t.rarity].name} · `
  }${sortOf(t)}${t.tier ? ` · tier ${tierName(t.tier)}` : ''}`

/** One side of a comparison: what it is called there, its piece if it has
 * one, and what the hero would wear with it. */
export type Side = { label: string; p?: Piece; worn: Worn }

// A side's piece: its name, kind, and own stats.
let side = ({ label, p }: Omit<Side, 'worn'>) => {
  let stats = p && itemStats(p)
  return `<div class="Compare_Side ${
    tint(p?.rarity)
  }"><small class=Compare_Label>${esc(label)}</small>${
    p
      ? `<b class=Rarity>${esc(p.name)}</b><small>${esc(sortLine(p))}</small>`
      : '<small>Nothing</small>'
  }${stats ? `<div class="Pack_Rolled Rarity">${stats}</div>` : ''}</div>`
}

/** A piece on its own, as a card. */
export let solo = (label: string, p: Piece): string =>
  `<div class="Compare Compare-one">${side({ label, p })}</div>`

/** Candidate and worn pieces, followed by the hero's resulting changes.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { piece } from './rarity.ts'
 * let hero = { lvl: 3, learned: [] }
 * let h = { eid: 'a', kind: 'helm2', n: 1 }
 * let bag = { label: 'In your bag', p: piece(h), worn: { head: h } }
 * let bare = { label: 'Worn', worn: {} }
 * let card = versus(hero, bag, bare)
 * assertEquals(card.includes('Pack_Up'), true)
 * assertEquals(card.includes('Pack_Down'), false)
 * assertEquals(versus(hero, bare, bag).includes('Pack_Up'), false)
 * assertEquals(versus(hero, bag, bag).includes('No listed stats change'), true)
 * ```
 */
export let versus = (s: Hero, then: Side, now: Side): string => {
  let changes = moved(numbers(s, now.worn), numbers(s, then.worn))
  return `<div class=Compare>${side(then)}${
    side(now)
  }<div class=Compare_Impact><small class=Compare_Label>If equipped</small>${
    changes || '<small class=Compare_Same>No listed stats change.</small>'
  }</div></div>`
}

/** An exact piece and the bounds of its next upgrade, calculated through
 * the same worn gear as a finished upgrade. */
export let stepRange = (s: Hero, now: Side, low: Side, high: Side): string => {
  let range = (a: string, b: string) => a == b ? a : `${a}–${b}`
  let own = GEAR_STATS.flatMap((stat) => {
    let a = now.p?.[stat] ?? 0, b = low.p?.[stat] ?? 0
    let c = high.p?.[stat] ?? 0
    if (a == b && a == c) return []
    return [
      `<span class=Pack_Num>${statName(stat)} ${
        statValue(stat, a)
      } → <em class=Pack_Up>${
        range(statValue(stat, b), statValue(stat, c))
      }</em></span>`,
    ]
  }).join('')
  let [a, b, c] = [now, low, high].map((x) => numbers(s, x.worn))
  let yours = LINES.flatMap((line) => {
    let x = a[line.k], y = b[line.k], z = c[line.k]
    if (x == y && x == z) return []
    return [
      `<span class=Pack_Num>${line.name} ${line.shows(x)} → <em class=Pack_Up>${
        range(line.shows(y), line.shows(z))
      }</em></span>`,
    ]
  }).join('')
  return `<div class="Compare Compare-one">${
    side(now)
  }<small class=Compare_Label>Upgrade to +${
    low.p?.plus ?? 0
  }: current → possible result</small>${
    own ? `<small class=Compare_Label>Item stats</small>${own}` : ''
  }${
    yours ? `<small class=Compare_Label>If equipped</small>${yours}` : ''
  }</div>`
}
