/**
 * A tooltip: the words a pointer resting on something reveals. Showing it is
 * the caller's; web's overlay.tsx, which listens for `[data-tip]`, floats
 * one of these.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A tooltip. */
export let Tip: Part = el('div', 'Tip')

/** A raised line. */
export let sheet = (c: Colors): Sheet => ({
  Tip: { fg: c.text, bg: c.surface },
})

/** One tip. */
export let specimens = (): Specimen[] => [
  ['Tip', h(Tip, {}, '2026-09-29 19:12:21')],
]
