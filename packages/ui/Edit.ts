/**
 * A property's value where it can be changed: the controls @yaks/render's
 * `editors` build (an `input`, a `select`, a `textarea`, each of class
 * `Edit`), and the plain `span.Edit` they show where a value cannot be
 * written. The controls are built by the renderer through whatever
 * hyperscript its host gives it, so this part is the class they share and its
 * look; `Edit` is that span, for a caller drawing a value the same way.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A value shown where an editor would be. */
export let Edit: Part = el('span', 'Edit')

/** A value is ink; a terminal paints a control's value as its text. */
export let sheet = (c: Colors): Sheet => ({
  Edit: { fg: c.text },
})

// The controls as a renderer builds them, each wearing the class.
let Input = el('input', 'Edit')
let Select = el('select', 'Edit')
let Area = el('textarea', 'Edit')

/** Each control, and the read-only value. */
export let specimens = (): Specimen[] => [
  ['Edit, text', h(Input, { type: 'text', value: 'Inbox' })],
  ['Edit, number', h(Input, { type: 'number', value: 2 })],
  [
    'Edit, enum',
    h(
      Select,
      { value: 'open' },
      ['—', 'open', 'done'].map((v) => h('option', { value: v }, v)),
    ),
  ],
  [
    'Edit, bool',
    h(Input, { type: 'checkbox', checked: true }),
  ],
  ['Edit, json', h(Area, { value: '{"x": 1}' })],
  ['Edit, read-only', h(Edit, {}, '2026-09-29T19:12:21Z')],
]
