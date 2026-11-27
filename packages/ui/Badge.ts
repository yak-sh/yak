/**
 * How many wait on the person, as a number on a pill: `<Badge>3</Badge>`
 * beside a link, a button or a heading. It is in the negative role's colour,
 * the colour of what needs them, so it is kept for what is new, an alert or
 * a notice; its words may say what the number counts (`2 errors`). Given as
 * a button or a link, it opens what waits. `Badge-quiet` is a plain count, how many there are: the number
 * alone, muted, with no pill. Whether to draw one at all (none for nothing)
 * is the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { createElement as h } from 'react'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A count of what waits, or, quiet, of what there is. */
export let Badge: Part = el('span', 'Badge')

/** What it is, in a line. */
export let description =
  'How many wait on the person, as a number on a pill; quiet, a plain count.'

/** A terminal says the number in the negative colour, bold; a quiet one
 * muted. */
export let sheet = (c: Colors): Sheet => ({
  Badge: { fg: c.negative, bold: true },
  'Badge-quiet': { fg: c.muted, bold: false },
})

/** One, a count past a hundred, and a plain count. */
export let specimens = (): Specimen[] => [
  ['Badge', h(Badge, {}, '3')],
  ['Badge, many', h(Badge, {}, '128')],
  ['Badge-quiet', h(Badge, { mod: 'quiet' }, '24')],
  ['Badge as a button', h(Badge, { as: 'button', type: 'button' }, '2 errors')],
]
