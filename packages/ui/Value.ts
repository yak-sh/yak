/**
 * A stored value, as it was stored: its shape is its variant. `num` a number,
 * `bool` a flag, `id` an identifier stored raw, `time` a moment, `json`
 * structure, `nil` nothing at all (`null`, `""`), and `text` a string that
 * keeps its newlines. What the value means is the caller's.
 *
 * A value that can be changed where it stands is `editable`, `editing` while
 * it is typed over (the caller makes it `contenteditable`, so it stays the
 * same element in the same place), and `refused` when the change it was
 * given was turned down.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A value. */
export let Value: Part = el('span', 'Value')

/** The shapes a value comes in. */
export let shapes = ['text', 'num', 'bool', 'id', 'time', 'json', 'nil']

/** A shape is a colour. */
export let sheet = (c: Colors): Sheet => ({
  Value: { fg: c.text },
  'Value-num': { fg: c.number },
  'Value-bool': { fg: c.literal },
  'Value-id': { fg: c.dim },
  'Value-time': { fg: c.time },
  'Value-json': { fg: c.muted },
  'Value-nil': { fg: c.dim, italic: true },
  'Value-refused': { fg: c.negative, underline: true },
})

let samples: Record<string, string> = {
  text: 'two lines\nkept apart',
  num: '42',
  bool: 'true',
  id: '7dec2706-bb85-8678-ae9d-9dad0b7cd86b',
  time: '2026-09-29T19:12:21Z',
  json: '{"prefix":"W"}',
  nil: 'null',
}

/** Each shape, and a value as it is changed in place. */
export let specimens = (): Specimen[] => [
  ...shapes.map((s): Specimen => [
    `Value-${s}`,
    h(Value, { mod: s }, samples[s]),
  ]),
  ['Value-editable', h(Value, { mod: 'editable' }, 'Inspect the data model')],
  [
    'Value-editing',
    h(Value, {
      mod: ['editable', 'editing'],
      contentEditable: 'plaintext-only',
    }, 'Inspect the data'),
  ],
  [
    'Value-refused',
    h(Value, {
      mod: ['editable', 'refused'],
      title: 'task.status needs one of open, done',
    }, 'finished'),
  ],
]
