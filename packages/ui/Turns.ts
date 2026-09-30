/**
 * A stretch of a conversation, in order: each `Turns.Turn` is `Who` said it
 * and `Text`, what they said (as much of it as the caller keeps). `Turn-on` is
 * the one the page is about, lit; `Turn-quiet` is one that is not prose (a
 * tool called, what it answered), dim. `Turns.More` says what came before or
 * after and was left out. A `Who` given an `href` links to the turn, and
 * still reads as who spoke.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A stretch of a conversation. */
export let Turns: Part & Record<'Turn' | 'Who' | 'Text' | 'More', Part> = block(
  'div',
  'Turns',
  {
    Turn: 'div',
    Who: 'span',
    Text: 'div',
    More: 'div',
  },
)

/** What it is, in a line. */
export let description =
  'A stretch of a conversation: who said each turn, and what.'

/** Each turn a line of its own, who first; the lit one bold, a quiet one
 * dim. */
export let sheet = (c: Colors): Sheet => ({
  Turns: { gap: true },
  Turns_Turn: { block: true, spaced: true, row: true },
  'Turns_Turn-on': { bold: true },
  'Turns_Turn-quiet': { fg: c.dim },
  Turns_Who: { fg: c.who, width: 10, ellipsis: true },
  Turns_Text: { grow: true, wrap: true },
  Turns_More: { fg: c.dim },
})

let { Turn, Who, Text, More } = Turns
let turn = (who: string, text: string, mod?: string) =>
  h(Turn, { mod }, h(Who, {}, who), h(Text, {}, text))

/** Three turns, the middle one lit, and a quiet one. */
export let specimens = (): Specimen[] => [
  [
    'Turns, Turn, Who, Text, Turn-on, Turn-quiet, More',
    h(
      Turns,
      {},
      h(More, {}, '12 before'),
      turn('agent', 'The port runs; here is what is new since yesterday.'),
      turn(
        'Jeff',
        "i'm talking about you porting endpoints i don't want!",
        'on',
      ),
      turn('agent', 'ran graph_query', 'quiet'),
      turn('agent', "You're right, and I was answering the wrong complaint."),
    ),
  ],
]
