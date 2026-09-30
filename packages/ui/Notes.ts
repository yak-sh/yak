/**
 * Notes left on something, under its heading: each `Notes.Item` is its
 * `Text`, `Who` left it and `When`; a note seen to is `Item-done`. A new one
 * is typed on a `Say` line under them.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Button } from './Button.ts'
import { Field } from './Field.ts'
import { Say } from './Say.ts'

/** Notes. */
export let Notes: Part & Record<'Item' | 'Text' | 'Who' | 'When', Part> = block(
  'div',
  'Notes',
  {
    Item: 'div',
    Text: 'span',
    Who: 'span',
    When: 'span',
  },
)

/** A note is a line of its own; who is blue, when is dim, a done one dim. */
export let sheet = (c: Colors): Sheet => ({
  Notes_Item: { block: true, spaced: true },
  'Notes_Item-done': { fg: c.dim },
  Notes_Who: { fg: c.blue },
  Notes_When: { fg: c.dim },
})

let { Item, Text, Who, When } = Notes

/** Two notes, one seen to, and the line a third is typed on. */
export let specimens = (): Specimen[] => [
  [
    'Notes, Item, Text, Who, When, Item-done',
    h(
      Notes,
      {},
      h(
        Item,
        {},
        h(Text, {}, 'status should be an enum'),
        h(Who, {}, 'Jeff'),
        h(When, {}, '5 minutes ago'),
      ),
      h(
        Item,
        { mod: 'done' },
        h(Text, {}, 'owner is never set'),
        h(Who, {}, 'S-45466'),
        h(When, {}, 'yesterday'),
      ),
    ),
  ],
  [
    'Notes, and a Say line',
    h(
      Notes,
      {},
      h(
        Say,
        {},
        h(Field, { value: '', placeholder: 'a note…' }),
        h(Button, { type: 'submit' }, 'note'),
      ),
    ),
  ],
]
