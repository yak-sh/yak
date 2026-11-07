/**
 * A line the page says back: what a press did, or, as `Notice-negative`,
 * why it did not. Empty, it takes no room, so a page can hold one ready for
 * a script to fill.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'

/** A line said back. */
export let Notice: Part = el('p', 'Notice')

/** What it is, in a line. */
export let description = 'A line the page says back: what a press did.'

/** It describes what happened, so it is muted; a refusal is negative. */
export let sheet = (c: Colors): Sheet => ({
  Notice: { fg: c.muted },
  'Notice-negative': { fg: c.negative },
})

/** A notice on a phone is a small line, in the tone it is said in. */
export let native = (c: Colors): Native => ({
  Notice: { color: c.muted, fontSize: 14 },
  'Notice-negative': { color: c.negative, fontSize: 14 },
})

/** What a press did, and why one did not. */
export let specimens = (): Specimen[] => [
  ['Notice', h(Notice, { role: 'status' }, 'Saved. Your apps live there now.')],
  [
    'Notice-negative',
    h(Notice, { mod: 'negative', role: 'status' }, 'That name is taken.'),
  ],
]
