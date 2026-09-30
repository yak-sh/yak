/**
 * A list of choices, one to a row, one of them picked: each `Choices.Item`
 * holds its `Text` and, after it, a `Note` saying what it is. Which one is
 * picked, what taking one does and where the list floats are the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A list of choices. */
export let Choices: Part & Record<'Item' | 'Text' | 'Note', Part> = block(
  'div',
  'Choices',
  { Item: 'div', Text: 'span', Note: 'span' },
)

/** What it is, in a line. */
export let description = 'A list of choices, one to a row, one of them picked.'

/** A choice is a row of its own, its word and note a space apart; the one
 * under the pointer is raised a little, the picked one more. */
export let sheet = (c: Colors): Sheet => ({
  Choices_Item: { block: true, spaced: true },
  'Choices_Item-hover': { bg: c.surface },
  'Choices_Item-on': { bg: c.card, bold: true },
  Choices_Note: { fg: c.dim },
})

let { Item, Text, Note } = Choices

let choice = (text: string, note: string, mod?: string) =>
  h(Item, { mod }, h(Text, {}, text), h(Note, {}, note))

/** Three choices, the first picked, the last under the pointer. */
export let specimens = (): Specimen[] => [
  [
    'Choices, Item-on, Item-hover, Text, Note',
    h(
      Choices,
      {},
      choice('.status', 'task', 'on'),
      choice('.stamp', 'doc · stamped'),
      choice('.session', 'claim · ref', 'hover'),
    ),
  ],
]
