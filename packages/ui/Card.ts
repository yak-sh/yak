/**
 * A card: one surface holding related things, flat on the page, what it
 * holds a gap apart. Its `Head`, where it has one, runs across its top and
 * is ruled off under it: a `Mark` (a picture of what it is), the `Title`,
 * how it stands (a `State`), then its `Actions`, pushed to the far side. A
 * `Sub` under the head says what the card is, in a line. Rows in a card run
 * to its edges.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { Button } from './Button.ts'
import { block, type Part } from './el.ts'
import { State } from './State.ts'
import type { Colors, Native, Specimen } from './theme.ts'

/** A card. */
export let Card:
  & Part
  & Record<'Head' | 'Mark' | 'Title' | 'Actions' | 'Sub', Part> = block(
    'section',
    'Card',
    {
      Head: 'header',
      Mark: 'span',
      Title: 'h2',
      Actions: 'div',
      Sub: 'p',
    },
  )

/** What it is, in a line. */
export let description =
  'One surface holding related things, its head ruled off across the top.'

/** A card is a block a blank line apart from the next; its head is one
 * line, the title in the heading's ink. */
export let sheet = (c: Colors): Sheet => ({
  Card: { gap: true },
  Card_Head: { row: true, spaced: true },
  Card_Title: { fg: c.heading, bold: true },
  Card_Actions: { spaced: true },
  Card_Sub: { fg: c.muted },
})

/** A card on a phone is a raised surface, its corners rounded, its head
 * one row with the title at one end and the actions at the other. */
export let native = (c: Colors): Native => ({
  Card: { backgroundColor: c.card, borderRadius: 14, padding: 16, gap: 12 },
  Card_Head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  Card_Title: { fontSize: 20, fontWeight: '600', color: c.heading },
  Card_Sub: { fontSize: 14, color: c.muted },
  Card_Actions: { flexDirection: 'row', gap: 8 },
})

let { Head, Mark, Title, Actions, Sub } = Card

/** A card with all its head holds, and one with no head at all. */
export let specimens = (): Specimen[] => [
  [
    'Card, Head, Mark, Title, Actions, Sub',
    h(
      Card,
      {},
      h(
        Head,
        {},
        h(Mark, { 'aria-hidden': true }, '☀'),
        h(Title, {}, 'Weather API'),
        h(State, { mod: 'positive' }, 'Connected'),
        h(Actions, {}, h(Button, { type: 'button' }, 'Disconnect')),
      ),
      h(Sub, {}, 'Forecasts for any place on Earth.'),
    ),
  ],
  [
    'Card-button',
    h(
      Card,
      { mod: 'button', href: '#' },
      h(Mark, { 'aria-hidden': true }, '☀'),
      h(Title, null, 'Weather API'),
      h(Sub, null, 'Forecasts for any place on Earth.'),
    ),
  ],
  [
    'Card',
    h(Card, {}, h('p', null, 'What a card holds, a gap from what follows.')),
  ],
]
