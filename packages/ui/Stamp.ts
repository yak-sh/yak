/**
 * A moment, said the human way: `5 minutes ago`. The words are the
 * caller's; the full time rides a `data-tip` when there is one.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A moment. */
export let Stamp: Part = el('span', 'Stamp')

/** Dim. */
export let sheet = (c: Colors): Sheet => ({
  Stamp: { fg: c.dim, dim: true },
})

/** One moment, and one with a second part. */
export let specimens = (): Specimen[] => [
  ['Stamp', h(Stamp, {}, '5 minutes ago')],
  [
    'Stamp, two parts',
    h(
      Stamp,
      {},
      h('span', null, '3 days ago'),
      h('span', null, '· edited 1 hour ago'),
    ),
  ],
]
