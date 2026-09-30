/**
 * A value where it can be changed. `Edit` is the value itself, a span typed
 * over where it stands (@yaks/editors `InlineEdit` makes it
 * `contenteditable`, so it stays the same element in the same place). The
 * same class on an `input` or a `select` makes a control that reads as the
 * value it holds; `Edit-fit` is one as wide as what it holds, for a control
 * sitting in a line beside other things rather than on a row of its own.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A value, typed over where it stands. */
export let Edit: Part = el('span', 'Edit')

/** What it is, in a line. */
export let description =
  'A value where it can be changed, typed over where it stands.'

/** A value is ink; a terminal paints a control's value as its text. */
export let sheet = (c: Colors): Sheet => ({
  Edit: { fg: c.text },
})

let Input = el('input', 'Edit')
let Select = el('select', 'Edit')

/** The value at rest and typed over, and each control. */
export let specimens = (): Specimen[] => [
  ['Edit', h(Edit, {}, 'Inspect the data model')],
  [
    'Edit, typed over',
    h(Edit, { contentEditable: 'plaintext-only' }, 'Inspect the data'),
  ],
  ['Edit, text', h(Input, { type: 'text', value: 'Inbox' })],
  [
    'Edit, a choice',
    h(
      Select,
      { value: 'open' },
      ['—', 'open', 'done'].map((v) => h('option', { value: v }, v)),
    ),
  ],
  [
    'Edit-fit',
    h(
      Select,
      { mod: 'fit', value: '' },
      h('option', { value: '' }, '+ component'),
    ),
  ],
]
