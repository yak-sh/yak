// What wearing a piece would change, for the glass to show: the numbers a
// hero's sheet shows for what they wear (`numbers`), the blow and health an
// ability would be done with (`doer`), what they would wear with a piece put
// on or a slot taken off (`trying`, `bare`), the difference between two of
// those, line by line in green or red (`diff`), and what a piece rolled, in
// its rarity's colour (`rolled`). The pack's card, the compare tip over the
// bag, and a station's upgrades all say it this way.
import type { Doer } from './abilities.ts'
import type { Slot } from './arms.ts'
import { hands, kitOf, twins, type Worn } from './gear.ts'
import { type Glyph, glyphText } from './glyphs.ts'
import { ITEMS } from './items.ts'
import type { Sheet } from './play.ts'
import { BONUSES, type Piece } from './rarity.ts'
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

/** Each number, its glyph, how it reads, and whether more is better. */
export let LINES: [keyof Numbers, Glyph, (n: number) => string, boolean][] = [
  ['blow', 'blow', (n) => `${n} a blow`, true],
  ['twin', 'blow', (n) => `${n} with the other hand`, true],
  ['pace', 'pace', (n) => `every ${n.toFixed(2)} s`, false],
  ['reach', 'reach', (n) => `reach ${n} m`, true],
  ['armour', 'armour', (n) => `armour ${n}`, true],
  ['hp', 'health', (n) => `health ${n}`, true],
  ['speed', 'speed', (n) => `speed +${n}%`, true],
  ['luck', 'luck', (n) => `great blows ${n}%`, true],
]

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

/** Each line where `b` differs from `a`: `b`'s number, and by how much, in
 * green where it is better and red where it is worse. */
export let diff = (a: Numbers, b: Numbers): string =>
  LINES.filter(([k]) => a[k] != b[k]).map(([k, mark, say, more]) => {
    let d = Math.round((b[k] - a[k]) * 100) / 100
    let good = more ? d > 0 : d < 0
    let sign = d > 0 ? '+' : '−'
    let shown = k == 'pace' ? `${Math.abs(d).toFixed(2)} s` : Math.abs(d)
    return `<span class=Pack_Num>${glyphText(mark)} ${say(b[k])} <em class="${
      good ? 'Pack_Up' : 'Pack_Down'
    }">${sign}${shown}</em></span>`
  }).join('')

/** What a piece rolled, each bonus with its glyph, and a legendary's power. */
export let rolled = (p: Piece): string =>
  p.bonuses.map(([stat, n]) =>
    `<span class=Pack_Num>${glyphText(BONUSES[stat].icon)} ${
      BONUSES[stat].says(n)
    }</span>`
  ).join('') +
  (p.legend
    ? `<span class=Pack_Legend>${glyphText(p.legend.icon)} ${
      esc(p.legend.says)
    }</span>`
    : '')
