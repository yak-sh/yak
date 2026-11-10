/**
 * How many wait on the person, as a number on a pill: `<Badge>3</Badge>`
 * beside a link, a button or a heading. It is in the negative role's colour,
 * the colour of what needs them. Whether to draw one at all (none for
 * nothing) is the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A count of what waits. */
export let Badge: Part = el('span', 'Badge')

/** What it is, in a line. */
export let description = 'How many wait on the person, as a number on a pill.'

/** A terminal says the number in the negative colour, bold. */
export let sheet = (c: Colors): Sheet => ({
  Badge: { fg: c.negative, bold: true },
})

/** One, and a count past a hundred. */
export let specimens = (): Specimen[] => [
  ['Badge', h(Badge, {}, '3')],
  ['Badge, many', h(Badge, {}, '128')],
]
