/**
 * A text field: one line to type in, or several (`lines`), showing `value`
 * and, while it is empty, its `placeholder`; or one to pick a value in
 * (`choose`), its options its children. What typing means is the
 * caller's. `caret` is where the caret stands while the field has the
 * keyboard: a browser shows its own, and a terminal, which has no focus to
 * show it by, paints a cursor there (@yaks/tui reads it as `data-caret`).
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type FunctionComponent, h } from 'preact'
import { el, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Line = el('input', 'Field')
let Area = el('textarea', 'Field')
let Pick = el('select', 'Field')

/** What a field takes besides a part's props. */
export type FieldProps = Props & {
  /** several lines: a textarea, where a newline can be typed */
  lines?: boolean
  /** a value picked from its options, the field's children: a select */
  choose?: boolean
  /** the caret's offset into `value`, while the field has the keyboard */
  caret?: number
}

/** A text field. */
export let Field: FunctionComponent<FieldProps> = (
  { lines, choose, caret, ...p },
) => h(choose ? Pick : lines ? Area : Line, { ...p, 'data-caret': caret })

/** What it is, in a line. */
export let description =
  'A text field: one line to type in, or several, or one to pick in.'

/** Typed text is ink, whatever it sits in. */
export let sheet = (c: Colors): Sheet => ({
  Field: { fg: c.text, bg: c.surface, border: c.border },
  'Field-bare': { fg: c.text },
})

/** Empty, typed in, typed in with the caret shown, picked in, and bare. */
export let specimens = (): Specimen[] => [
  ['Field, empty', h(Field, { value: '', placeholder: 'filter…' })],
  ['Field', h(Field, { value: '.task.status=open' })],
  ['Field, caret', h(Field, { value: '.task.status=open', caret: 12 })],
  [
    'Field, choose',
    h(
      Field,
      { choose: true, value: 'open' },
      h('option', { value: 'open' }, 'open'),
      h('option', { value: 'done' }, 'done'),
    ),
  ],
  ['Field-bare, lines', h(Field, { mod: 'bare', lines: true, value: 'set' })],
]
