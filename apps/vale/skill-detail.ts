// Skill numbers and their effect on the hero, using the same calculations as
// the gear comparison and action bar.
import { type Ability, abilityStats, OFF, secs } from './abilities.ts'
import { HANDLES } from './arms.ts'
import {
  doer,
  moved,
  numbers,
  statMark,
  statName,
  statValue,
} from './compare.ts'
import { glyph } from './glyphs.ts'
import type { Sheet } from './play.ts'
import type { Stat } from './rarity.ts'
import { type Boon, formOf, SKILLS } from './skills.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
let line = (s: string) => `<span class=Pack_Num>${esc(s)}</span>`
type Hero = Pick<Sheet, 'lvl' | 'learned' | 'worn'>

/** A selected skill's bonuses, ability numbers, and current-to-learned hero
 * comparison. Already learned skills show their current effect once. */
export let skillDetail = (s: Hero, id: string): string => {
  let skill = SKILLS[id]
  if (!skill) return ''
  let known = s.learned.includes(id)
  let next = { ...s, learned: known ? s.learned : [...s.learned, id] }
  let names: Record<keyof Boon, Stat> = {
    force: 'force',
    pace: 'haste',
    health: 'hp',
    armour: 'armour',
    speed: 'speed',
    luck: 'luck',
  }
  // Health and armor passives multiply existing stats, rather than adding
  // the flat values found on gear.
  let stats = (Object.keys(names) as (keyof Boon)[]).flatMap((key) => {
    let n = skill.boon?.[key]
    let stat = names[key]
    return n == null ? [] : [
      `<span class="Pack_Num Stat Stat-${stat}">${statMark(stat)} ${
        statValue('force', n)
      } ${statName(stat)}</span>`,
    ]
  }).join('')
  if (skill.with) {
    stats += line(
      `With ${skill.with.map((f) => HANDLES[f]?.name ?? f).join(' or ')}`,
    )
  }
  if (skill.hand) {
    stats += line(`Allows a second ${HANDLES[skill.hand]?.name ?? skill.hand}`)
  }
  let abilities = ''
  let ability = skill.ability ?? (skill.hand ? OFF[skill.hand] : undefined)
  if (ability) {
    let before = formOf(ability, s.learned),
      after = formOf(ability, next.learned)
    if (before && after) {
      let effects = (a: Ability, hero: Hero) =>
        [
          ...abilityStats(a, doer(hero, hero.worn)),
          `Cooldown ${secs(a.cool)}`,
          ...(a.effects.some((e) => e.kind == 'renew')
            ? ['Ready again after a killing blow']
            : []),
        ].map(line).join('')
      abilities +=
        `<small class="Compare_Label Board_Ability Board_Discipline-${skill.discipline}">${
          glyph(after.icon)
        } ${esc(after.name)}${
          skill.hand ? ' · With a second weapon' : known ? '' : ' · Current'
        }</small><div class=Pack_Rolled>${
          effects(skill.hand ? after : before, skill.hand ? next : s)
        }</div>`
      if (!known && !skill.hand) {
        abilities +=
          `<small class=Compare_Label>→ If learned</small><div class=Pack_Rolled>${
            effects(after, next)
          }</div>`
      }
    }
  }
  let changes = moved(numbers(s, s.worn), numbers(next, s.worn))
  return `${
    stats
      ? `<small class=Compare_Label>Skill stats</small><div class=Pack_Rolled>${stats}</div>`
      : ''
  }${abilities}${
    known
      ? ''
      : `<div class=Compare_Impact><small class=Compare_Label>If learned with your current gear</small>${
        changes ||
        '<small class=Compare_Same>No listed hero stats change.</small>'
      }</div>`
  }`
}
