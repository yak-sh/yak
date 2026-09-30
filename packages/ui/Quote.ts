/**
 * Words somebody said, set apart as theirs: the `Text` verbatim, then `By`,
 * the line saying who said them, when and where (its parts kept apart by a
 * dot), and `Note`, what somebody else wrote about them, dim, so it is never
 * read as the words themselves.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h, toChildArray } from 'preact'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Base = block('figure', 'Quote', {
  Text: 'blockquote',
  By: 'figcaption',
  Note: 'p',
  Sep: 'span',
})

let { By: Line, Sep } = Base

/** Words somebody said. */
export let Quote: Part & Record<'Text' | 'By' | 'Note', Part> = Object
  .assign(Base, {
    By: ({ children, ...p }: Props) =>
      h(
        Line,
        p,
        toChildArray(children).flatMap((kid, i) =>
          i ? [h(Sep, { key: `sep${i}` }, '·'), kid] : [kid]
        ),
      ),
  })

/** What it is, in a line. */
export let description =
  'Words somebody said, verbatim: who said them, when and where.'

/** The words indented under a bar in the accent, the byline dim and apart,
 * the note dimmer still. */
export let sheet = (c: Colors): Sheet => ({
  Quote: { gap: true },
  Quote_Text: { fg: c.text, wrap: true, indent: 2 },
  Quote_By: { fg: c.dim, spaced: true, indent: 2 },
  Quote_Sep: { fg: c.border2 },
  Quote_Note: { fg: c.dim, italic: true, wrap: true, indent: 2 },
})

let { Text, By, Note } = Quote

/** A quote with all it says of itself. */
export let specimens = (): Specimen[] => [
  [
    'Quote, Text, By, Note',
    h(
      Quote,
      {},
      h(Text, {}, "i'm talking about you porting endpoints i don't want!"),
      h(
        By,
        {},
        h('span', {}, 'Jeff'),
        h('span', {}, '27 Aug'),
        h('a', { href: '#s' }, 'S-21436'),
      ),
      h(Note, {}, 'the agent kept reporting the port was not running'),
    ),
  ],
]
