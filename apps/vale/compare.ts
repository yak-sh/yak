// What wearing a piece would change, for the glass to show: the numbers a
// hero's sheet shows for what they wear (`numbers`), the blow and health an
// ability would be done with (`doer`), what they would wear with a piece put
// on or a slot taken off (`trying`, `bare`), the difference between two of
// those, line by line in green or red (`diff`), what a piece rolled, in its
// rarity's colour (`rolled`), a piece beside another, each with what it
// rolled and every number that would change, marked (`versus`), and what a
// step makes of a piece, its own numbers and the hero's, from what they are
// to what they would be (`step`). The pack's card, the compare tip over the
// bag, and a station's upgrades all say it this way.
import type { Doer } from './abilities.ts'
import { type Slot, sortOf, tierName } from './arms.ts'
import { hands, kitOf, twins, type Worn } from './gear.ts'
import { type Glyph, glyphText } from './glyphs.ts'
import { ITEMS } from './items.ts'
import type { Sheet } from './play.ts'
import { BONUSES, GRADES, type Piece, STATS, tint } from './rarity.ts'
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

/** A number a sheet shows: its glyph, how it reads around its value, how
 * the value is written, and whether more is better. */
export type Line = {
  k: keyof Numbers
  glyph: Glyph
  says: (x: string) => string
  shows?: (n: number) => string
  more: boolean
}

/** Each number a sheet shows. */
export let LINES: Line[] = [
  { k: 'blow', glyph: 'blow', says: (x) => `${x} a blow`, more: true },
  {
    k: 'twin',
    glyph: 'blow',
    says: (x) => `${x} with the other hand`,
    more: true,
  },
  {
    k: 'pace',
    glyph: 'pace',
    says: (x) => `every ${x} s`,
    shows: (n) => n.toFixed(2),
    more: false,
  },
  { k: 'reach', glyph: 'reach', says: (x) => `reach ${x} m`, more: true },
  { k: 'armour', glyph: 'armour', says: (x) => `armour ${x}`, more: true },
  { k: 'hp', glyph: 'health', says: (x) => `health ${x}`, more: true },
  { k: 'speed', glyph: 'speed', says: (x) => `speed +${x}%`, more: true },
  { k: 'luck', glyph: 'luck', says: (x) => `great blows ${x}%`, more: true },
]

/** A number, read in its line, with its glyph.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let pace = LINES.find((l) => l.k == 'pace')!
 * assertEquals(said(pace, 0.5).endsWith('every 0.50 s'), true)
 * ```
 */
export let said = (l: Line, n: number | string): string =>
  `${glyphText(l.glyph)} ${
    l.says(typeof n == 'number' ? (l.shows ?? String)(n) : n)
  }`

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

// A line's number in `b`, and how far it moved from `a`, in green where that
// is better and red where it is worse.
let line = (l: Line, a: Numbers, b: Numbers) => {
  let d = Math.round((b[l.k] - a[l.k]) * 100) / 100
  let shown = l.k == 'pace' ? `${Math.abs(d).toFixed(2)} s` : Math.abs(d)
  let by = d == 0
    ? ''
    : ` <em class="${better(l.more, a[l.k], b[l.k])}">${
      d > 0 ? '+' : '−'
    }${shown}</em>`
  return `<span class=Pack_Num>${said(l, b[l.k])}${by}</span>`
}

/** Each line where `b` differs from `a`: `b`'s number, and by how much, in
 * green where it is better and red where it is worse. */
export let diff = (a: Numbers, b: Numbers): string =>
  LINES.filter((l) => a[l.k] != b[l.k]).map((l) => line(l, a, b)).join('')

// A number from what it is to what it would be, the new one in green where
// that is better and red where it is worse.
let arrow = (x: string, y: string, more: boolean, a: number, b: number) =>
  `${x} → <em class="${better(more, a, b)}">${y}</em>`

/** Each line where `b` differs from `a`: from `a`'s number to `b`'s. */
export let moved = (a: Numbers, b: Numbers): string =>
  LINES.filter((l) => a[l.k] != b[l.k]).map((l) => {
    let show = l.shows ?? String
    return `<span class=Pack_Num>${
      said(l, arrow(show(a[l.k]), show(b[l.k]), l.more, a[l.k], b[l.k]))
    }</span>`
  }).join('')

/** Each of a piece's own numbers that differs in `b`: from what it is in
 * `a` to what it is in `b`. */
export let grown = (a: Piece, b: Piece): string =>
  STATS.filter((st) => (a[st] ?? 0) != (b[st] ?? 0)).map((st) => {
    let { shows, word, icon } = BONUSES[st], x = a[st] ?? 0, y = b[st] ?? 0
    return `<span class=Pack_Num>${glyphText(icon)} ${word} ${
      arrow(shows(x), shows(y), true, x, y)
    }</span>`
  }).join('')

/** What sort of thing a piece of gear is: its rarity when finer than common,
 * its sort, and its tier. */
export let sortLine = (t: Piece): string =>
  `${t.rarity == 'common' ? '' : `${GRADES[t.rarity].name} · `}${sortOf(t)}${
    t.tier
      ? ` · tier ${tierName(t.tier)} · levels ${12 * (t.tier - 1) + 1}–${
        12 * t.tier
      }`
      : ''
  }`

/** What a piece rolled, each bonus with its glyph, and a legendary's power. */
export let rolled = (p: Piece): string =>
  p.bonuses.map(([stat, n]) =>
    `<span class=Pack_Num>${glyphText(BONUSES[stat].icon)} ${
      BONUSES[stat].shows(n)
    } ${BONUSES[stat].word}</span>`
  ).join('') +
  (p.legend
    ? `<span class=Pack_Legend>${glyphText(p.legend.icon)} ${
      esc(p.legend.says)
    }</span>`
    : '')

/** One side of a comparison: what it is called there, its piece if it has
 * one, and what the hero would wear with it. */
export type Side = { label: string; p?: Piece; worn: Worn }

// A side's piece: named in its rarity's colour, what sort it is, and what it
// rolled.
let side = ({ label, p }: Omit<Side, 'worn'>) => {
  let rolls = p && rolled(p)
  return `<div class="Compare_Side ${
    tint(p?.rarity)
  }"><small class=Compare_Label>${esc(label)}</small>${
    p
      ? `<b class=Rarity>${esc(p.name)}</b><small>${esc(sortLine(p))}</small>`
      : '<small>Nothing</small>'
  }${rolls ? `<div class="Pack_Rolled Rarity">${rolls}</div>` : ''}</div>`
}

/** A piece on its own, as a card. */
export let solo = (label: string, p: Piece): string =>
  `<div class="Compare Compare-one">${side({ label, p })}</div>`

/** What would be (`then`) beside what is (`now`), as a card: each piece, and
 * under each, every number of the hero's that would change, `then`'s marked
 * by how much.
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
 * assertEquals(versus(hero, bag, bag).includes('Nothing would change'), true)
 * ```
 */
export let versus = (s: Hero, then: Side, now: Side): string => {
  let a = numbers(s, now.worn), b = numbers(s, then.worn)
  let lines = LINES.filter((l) => a[l.k] != b[l.k])
  return `<div class=Compare>${side(then)}${side(now)}${
    lines.map((l) => line(l, a, b) + line(l, a, a)).join('') ||
    `<small class=Compare_Same>Nothing would change.</small>`
  }</div>`
}

/** What a step makes of a piece (`now` to `then`), as a card: the piece as
 * it would be, each of its own numbers from what it is to what it would be,
 * and each of the hero's the same, worn.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { piece } from './rarity.ts'
 * let hero = { lvl: 3, learned: [] }
 * let at = (plus: number) => {
 *   let h = { eid: 'a', kind: 'cuirass3', n: 1, rarity: 'legendary' as const, plus }
 *   return { label: `At +${plus}`, p: piece(h), worn: { body: h } }
 * }
 * let card = step(hero, at(0), at(1))
 * assertEquals(/health \+\d+ → /.test(card), true)
 * assertEquals(card.includes('Nothing would change'), false)
 * assertEquals(step(hero, at(1), at(1)).includes('Nothing would change'), true)
 * ```
 */
export let step = (s: Hero, now: Side, then: Side): string => {
  let own = now.p && then.p ? grown(now.p, then.p) : ''
  let yours = moved(numbers(s, now.worn), numbers(s, then.worn))
  return `<div class="Compare Compare-one">${side(then)}${
    own ? `<small class=Compare_Label>The piece</small>${own}` : ''
  }${
    yours
      ? `<small class=Compare_Label>You</small>${yours}`
      : `<small class=Compare_Same>Nothing would change.</small>`
  }</div>`
}
