/**
 * A moment, said the human way: `5 minutes ago`. The words are the
 * caller's, or `relative`'s; the full time rides a `data-tip` when there is
 * one.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { Time } from './Time.ts'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A moment. */
export let Stamp: Part = el('span', 'Stamp')

/** What it is, in a line. */
export let description = 'A moment, said the human way: 5 minutes ago.'

/** Dim, its parts a space apart, as their gap keeps them in a browser. */
export let sheet = (c: Colors): Sheet => ({
  Stamp: { fg: c.muted, spaced: true },
})

/** One moment, and one with a second part. */
export let specimens = (): Specimen[] => [
  [
    'Stamp',
    h(
      Stamp,
      {},
      h(Time, {
        at: '2026-11-06T15:42:00Z',
        now: 1794238920000,
        timeZone: 'UTC',
      }),
    ),
  ],
  [
    'Stamp, two parts',
    h(
      Stamp,
      {},
      h(Time, {
        at: '2026-11-06T15:42:00Z',
        now: 1794238920000,
        timeZone: 'UTC',
      }),
      h(
        'span',
        null,
        '· edited ',
        h(Time, {
          at: '2026-11-06T16:42:00Z',
          now: 1794238920000,
          timeZone: 'UTC',
        }),
      ),
    ),
  ],
]
