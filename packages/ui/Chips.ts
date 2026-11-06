/**
 * A row of chips that wraps like a handful of notes:
 * `<Chips><Chip>…</Chip><Chip>…</Chip></Chips>`. The row is the same shape
 * whether its chips are words or links; a list of them may hold each in a
 * list item.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import { Chip } from './Chip.ts'
import type { Colors, Specimen } from './theme.ts'

/** A row of chips. */
export let Chips: Part = el('div', 'Chips')

/** What it is, in a line. */
export let description = 'A row of chips that wraps.'

/** Its chips stay apart, as in a browser. */
export let sheet = (_c: Colors): Sheet => ({
  Chips: { spaced: true },
})

/** A row of words, and one of links. */
export let specimens = (): Specimen[] => [
  [
    'Chips',
    h(
      Chips,
      {},
      ['a recipe box', 'a garden diary', 'a chore chart'].map((said) =>
        h(Chip, { key: said }, said)
      ),
    ),
  ],
  [
    'Chips of links',
    h(
      Chips,
      {},
      ['make', 'start', 'ask'].map((at) =>
        h(Chip, { key: at, href: '#Chips' }, at)
      ),
    ),
  ],
]
