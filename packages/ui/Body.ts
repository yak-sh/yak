/**
 * The text of a thing, to be read: its paragraphs (rendered markdown, or plain
 * lines) at a reading measure, in the ink. `Body-short` is one that is only a
 * line or two, set a little smaller, as the gist of a longer one.
 * `Body-typed` is one a press types into, and says so under the pointer.
 * `Body-source` is a document's source as written, in a `pre` it holds: every
 * character as it stands, its lines kept and wrapped at the measure, in the
 * face of what is typed, such as the markdown an agent is given.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'

let tags = {
  Paragraph: 'p',
  Ordered: 'ol',
  Unordered: 'ul',
  Item: 'li',
  Source: 'pre',
  Heading: 'h1',
  Table: 'table',
  Head: 'thead',
  Rows: 'tbody',
  Row: 'tr',
  HeadingCell: 'th',
  Cell: 'td',
  Link: 'a',
  Image: 'img',
  Quote: 'blockquote',
  Code: 'code',
  Rule: 'hr',
  Strong: 'strong',
  Emphasis: 'em',
}

/** A body of text. */
export let Body:
  & Part
  & Record<
    | 'Paragraph'
    | 'Ordered'
    | 'Unordered'
    | 'Item'
    | 'Source'
    | 'Heading'
    | 'Table'
    | 'Head'
    | 'Rows'
    | 'Row'
    | 'HeadingCell'
    | 'Cell'
    | 'Link'
    | 'Image'
    | 'Quote'
    | 'Code'
    | 'Rule'
    | 'Strong'
    | 'Emphasis',
    Part
  > = block('div', 'Body', tags)

let names: Record<string, string> = Object.fromEntries(
  Object.entries(tags).map(([part, tag]) => [tag, `Body_${part}`]),
)

/** The part class for an element in rendered prose. A markup renderer adds
 * this beside its own classes where it emits the element. */
export let bodyClass = (tag: string): string | undefined =>
  /^h[1-6]$/.test(tag) ? `Body_Heading Body_Heading-${tag[1]}` : names[tag]

/** What it is, in a line. */
export let description = 'The text of a thing, to be read, at its measure.'

/** It folds to the width, and a blank line follows it. */
export let sheet = (c: Colors): Sheet => ({
  Body: { fg: c.text, wrap: true, gap: true },
  'Body-short': { fg: c.muted },
  'Body-source': { fg: c.text },
  Body_Link: { fg: c.link, underline: true },
  Body_Ref: { fg: c.link, underline: false },
})

/** A body of two paragraphs and a quote, and a short one. */
export let specimens = (): Specimen[] => [
  [
    'Body',
    h(
      Body,
      {},
      h(
        'p',
        null,
        'Tests never share a lock. A run that waits on another run is two ' +
          'runs pretending to be one.',
      ),
      h('blockquote', null, h('p', null, 'runs never share a lock')),
    ),
  ],
  ['Body-short', h(Body, { mod: 'short' }, 'what a test checks')],
  [
    'Body-typed',
    h(Body, { mod: 'typed' }, h('p', null, 'Click to type into this text.')),
  ],
  [
    'Body-source',
    h(
      Body,
      { mod: 'source' },
      h(
        Body.Source,
        null,
        '# N-1 reviewer\n\nCheck changes against the tests, and say which ' +
          'test catches each one.\n\n---\n\n# M-2 tests never share a lock',
      ),
    ),
  ],
]

/** The same interface on a native host. */
export let native = (_c: Colors): Native => ({
  Body: { gap: 8 },
})
