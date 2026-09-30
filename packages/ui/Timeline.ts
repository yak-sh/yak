/**
 * Moments in order, one `Timeline.Item` each: `When` it happened, `Who` did
 * it, and `What` it was, under them. The order, newest or oldest first, is
 * the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Chip } from './Chip.ts'
import { Value } from './Value.ts'

/** A timeline. */
export let Timeline: Part & Record<'Item' | 'When' | 'Who' | 'What', Part> =
  block('ol', 'Timeline', {
    Item: 'li',
    When: 'span',
    Who: 'span',
    What: 'div',
  })

/** What it is, in a line. */
export let description = 'Moments in order: when each happened, who, and what.'

/** When is dim, who wears its own colour, and what hangs under them. */
export let sheet = (c: Colors): Sheet => ({
  Timeline_When: { fg: c.dim },
  Timeline_Who: { fg: c.who },
  Timeline_Item: { spaced: true },
  Timeline_What: { indent: 2, spaced: true },
})

let { Item, When, Who, What } = Timeline

/** Two moments. */
export let specimens = (): Specimen[] => [
  [
    'Timeline, Item, When, Who, What',
    h(
      Timeline,
      {},
      h(
        Item,
        {},
        h(When, {}, '5 minutes ago'),
        h(Who, {}, 'S-45466'),
        h(
          What,
          {},
          h(Chip, { mod: '1' }, 'task'),
          ' ',
          h(Value, { mod: 'json' }, '{"status":"done"}'),
        ),
      ),
      h(
        Item,
        {},
        h(When, {}, '2 hours ago'),
        h(Who, {}, 'Jeff'),
        h(What, {}, h(Chip, { mod: '0' }, 'doc'), ' ', h(Value, {}, 'created')),
      ),
    ),
  ],
]
