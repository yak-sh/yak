/**
 * A document where it is read and typed into: `Doc`, its title (`Doc.Title`)
 * over its text (a `Body`). `Doc-typed` is one a press types into: its title
 * says so under the pointer, as a typed `Body` does, and a title with nothing
 * written yet says where one goes.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import { Body } from './Body.ts'
import { Edit } from './Edit.ts'
import type { Colors, Specimen } from './theme.ts'

/** A document. */
export let Doc: Part & Record<'Title', Part> = block('article', 'Doc', {
  Title: 'h3',
})

/** What it is, in a line. */
export let description = 'A document where it is read and typed into.'

/** Its title in the heading's ink over its text, a blank line after. */
export let sheet = (c: Colors): Sheet => ({
  Doc: { gap: true },
  Doc_Title: { fg: c.heading },
})

/** A document read, one typed into, and one with no title yet. */
export let specimens = (): Specimen[] => [
  [
    'Doc',
    h(
      Doc,
      {},
      h(Doc.Title, {}, 'Signal over noise'),
      h(Body, {}, h('p', null, 'What the owner says is the signal.')),
    ),
  ],
  [
    'Doc-typed',
    h(
      Doc,
      { mod: 'typed' },
      h(Doc.Title, {}, h(Edit, {}, 'Signal over noise')),
      h(
        Body,
        { mod: 'typed' },
        h('p', null, 'What the owner says is the signal.'),
      ),
    ),
  ],
  [
    'Doc-typed, no title yet',
    h(
      Doc,
      { mod: 'typed' },
      h(Doc.Title, {}, h(Edit, {})),
      h(Body, { mod: 'typed' }, h('p', null, 'nothing is written yet')),
    ),
  ],
]
