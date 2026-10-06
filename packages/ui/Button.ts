/**
 * A press: a word or a glyph that does something when pressed. `Button-add`
 * offers to add what is not there yet, `Button-danger` destroys something,
 * `Button-go` is the one to press where a sheet offers one, and
 * `Button-quiet` stays out of the way until the pointer finds it. What a
 * press does is the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A button. */
export let Button: Part = el('button', 'Button')

/** What it is, in a line. */
export let description = 'A word or a glyph that does something when pressed.'

/** A press in a terminal is its word, bracketed by its colour. */
export let sheet = (c: Colors): Sheet => ({
  Button: { fg: c.accent },
  'Button-add': { fg: c.dim },
  'Button-danger': { fg: c.negative },
  'Button-go': { fg: c.bg, bg: c.accent, bold: true },
  'Button-quiet': { fg: c.dim },
})

/** Every variant. */
export let specimens = (): Specimen[] => [
  ['Button', h(Button, { type: 'button' }, 'send')],
  ['Button-add', h(Button, { type: 'button', mod: 'add' }, '+ component')],
  ['Button-danger', h(Button, { type: 'button', mod: 'danger' }, 'delete')],
  ['Button-go', h(Button, { type: 'button', mod: 'go' }, 'save')],
  ['Button-quiet', h(Button, { type: 'button', mod: 'quiet' }, '×')],
]
