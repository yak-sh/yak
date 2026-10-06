// Skill numbers and their effect on the hero, using the same calculations as
// the gear comparison and action bar, in the same lines: what a skill gives
// in ink, as a piece's own stats are, and each number learning it would
// change from what it is to what it would be, Better or Worse.
import { h, type JSX } from 'preact'
import { Section } from '@yaks/ui'
import {
  type Ability,
  type AbilityLine,
  abilityLines,
  type AbilityNumber,
  OFF,
  secs,
} from './abilities.ts'
import { HANDLES } from './arms.ts'
import {
  changes,
  doer,
  numbers,
  stat,
  statLine,
  stats,
  statValue,
  toward,
} from './compare.ts'
import type { Glyph } from './glyphs.ts'
import type { Sheet } from './play.ts'
import type { Stat } from './rarity.ts'
import { type Boon, formOf, SKILLS } from './skills.ts'
import { ValeStats } from './kit/ValeStats.ts'
import { mark, part } from './tile.ts'

type Hero = Pick<Sheet, 'lvl' | 'learned' | 'worn'>

// The stat each passive bonus is named as. Health and armor passives
// multiply existing stats, rather than adding the flat values found on gear.
let NAMES: Record<keyof Boon, Stat> = {
  force: 'force',
  pace: 'haste',
  health: 'hp',
  armour: 'armour',
  speed: 'speed',
  luck: 'luck',
}

// Each effect's icon, by its line's key (abilities.ts `abilityLines`).
let ICONS: Record<string, Glyph> = {
  hits: 'strike',
  damage: 'blow',
  arc: 'slice',
  far: 'reach',
  dash: 'dodge',
  stun: 'zap',
  bleed: 'droplet',
  guard: 'shield',
  ward: 'shieldPlus',
  heal: 'heartPlus',
  dot: 'flame',
  hot: 'heartPulse',
  area: 'target',
  sure: 'star',
  cooldown: 'pace',
  renew: 'refresh',
}
let iconOf = (key: string): Glyph =>
  ICONS[key] ?? (key.startsWith('debuff') ? 'droplet' : 'sparkles')

// An ability's lines as `hero` would use it: its effects, its cooldown, and
// whether a killing blow readies it again.
let lines = (a: Ability, hero: Hero): AbilityLine[] => [
  ...abilityLines(a, doer(hero, hero.worn)),
  {
    key: 'cooldown',
    parts: ['Cooldown ', {
      key: 'cooldown',
      n: a.cool,
      text: secs(a.cool),
      more: false,
    }],
  },
  ...(a.effects.some((e) => e.kind == 'renew')
    ? [{ key: 'renew', parts: ['Ready again after a killing blow'] }]
    : []),
]

// An ability's lines, each number `was` had read from what it was to what it
// would be; a line it lacked is a gain, Better whole.
let compared = (now: AbilityLine[], was?: AbilityLine[]) =>
  now.map((line) => {
    let before = was?.find((l) => l.key == line.key)
    let number = (n: AbilityNumber) => {
      let old = before?.parts.find((p): p is AbilityNumber =>
        typeof p != 'string' && p.key == n.key
      )
      return !old || old.text == n.text
        ? n.text
        : [`${old.text} → `, toward(n.more, old.n, n.n, n.text)]
    }
    let words = line.parts.map((p) => typeof p == 'string' ? p : number(p))
    return stat(
      iconOf(line.key),
      ...(was && !before ? [h(ValeStats.Better, {}, words)] : words),
    )
  })

/** A picked skill's page under its head: what it gives, the ability it
 * makes stronger with each number from now to if learned, and how the
 * hero's numbers would change. A skill already learned shows what it does,
 * once. */
export let skillDetail = (s: Hero, id: string): JSX.Element[] => {
  let skill = SKILLS[id]
  if (!skill) return []
  let known = s.learned.includes(id)
  let next = { ...s, learned: known ? s.learned : [...s.learned, id] }
  let own = [
    ...(Object.keys(NAMES) as (keyof Boon)[]).flatMap((key) => {
      let n = skill.boon?.[key]
      return n == null ? [] : [statLine(NAMES[key], statValue('force', n))]
    }),
    ...(skill.with
      ? [
        stat(
          'blow',
          `With ${skill.with.map((f) => HANDLES[f]?.name ?? f).join(' or ')}`,
        ),
      ]
      : []),
    ...(skill.hand
      ? [
        stat(
          'blow',
          `Allows a second ${HANDLES[skill.hand]?.name ?? skill.hand}`,
        ),
      ]
      : []),
  ]
  let named = skill.ability ?? (skill.hand ? OFF[skill.hand] : undefined)
  let before = named && formOf(named, s.learned)
  let after = named && formOf(named, next.learned)
  // A second weapon's ability is new, and a learned skill's is as it is.
  let effects = before && after && (skill.hand
    ? part(
      [
        mark(after.icon),
        after.name,
        h(Section.Note, {}, 'With a second weapon'),
      ],
      stats(compared(lines(after, next))),
    )
    : part(
      [
        mark(after.icon),
        after.name,
        !known && h(Section.Note, {}, 'now → if learned'),
      ],
      stats(
        compared(
          lines(after, next),
          known ? undefined : lines(before, s),
        ),
      ),
    ))
  return [
    ...(own.length ? [part('Skill stats', stats(own))] : []),
    ...(effects ? [effects] : []),
    ...(known ? [] : [
      changes(
        'If learned with your current gear',
        numbers(s, s.worn),
        numbers(next, s.worn),
        'No listed hero stats change.',
      ),
    ]),
  ]
}
