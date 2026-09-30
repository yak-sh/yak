/**
 * A stored value, as it was stored: its shape is its variant. `num` a number,
 * `bool` a flag, `id` an identifier stored raw, `time` a moment, `json`
 * structure, `nil` nothing at all (`null`, `""`), and `text` a string that
 * keeps its newlines. What the value means is the caller's.
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

/** What it is, in a line. */
export let description =
  'A stored value, as it was stored: its shape is its variant.'

/** A shape is a colour. */
export let sheet = (c: Colors): Sheet => ({
  Value: { fg: c.text },
  'Value-num': { fg: c.number },
  'Value-bool': { fg: c.literal },
  'Value-id': { fg: c.dim },
  'Value-time': { fg: c.time },
  'Value-json': { fg: c.muted },
  'Value-nil': { fg: c.dim, italic: true },
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

/** Each shape. */
export let specimens = (): Specimen[] =>
  shapes.map((s): Specimen => [`Value-${s}`, h(Value, { mod: s }, samples[s])])
