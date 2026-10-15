/** Numbers, a line each: a piece's own, a skill's, the hero's. A line is its
 * `Mark` (an icon) beside its `Words`. A number that would change reads from
 * what it is to what it would be, the new one `Better` or `Worse`; a number
 * that stays, and a line that says what something is, are ink, so colour only
 * ever marks a change. `two` sets the lines in two columns where there is
 * room for them. */
import { block, type Colors, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'

export let Stats = block('div', 'Stats', {
  Stat: 'span',
  Mark: 'span',
  Words: 'span',
  Better: 'em',
  Worse: 'em',
})
export let description =
  'Numbers, a line each, coloured only where one would change.'
export let sheet = (c: Colors): Sheet => ({
  Stats_Stat: { block: true, spaced: true },
  Stats_Mark: { fg: c.muted },
  Stats_Better: { fg: c.positive },
  Stats_Worse: { fg: c.negative },
})
let { Stat, Mark, Words, Better, Worse } = Stats
let line = (mark: string, ...words: unknown[]) =>
  h(
    Stat,
    {},
    h(Mark, { 'aria-hidden': true }, mark),
    h(Words, {}, ...words as string[]),
  )
export let specimens = (): Specimen[] => [
  [
    'A piece’s own',
    h(
      Stats,
      {},
      line('⚔', '1.84× Weapon power'),
      line('♥', '+10 Health'),
    ),
  ],
  [
    'two: what would change, Better and Worse',
    h(
      Stats,
      { mod: 'two' },
      line('⚔', 'Attack 13 → ', h(Better, {}, '14')),
      line('◷', 'Attack interval 0.50 s → ', h(Worse, {}, '0.52 s')),
      line('♥', 'Health 80 → ', h(Better, {}, '91')),
    ),
  ],
]
