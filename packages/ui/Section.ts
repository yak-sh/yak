/**
 * A titled section of a page: its `Title` line, then what it holds. The title
 * line is one heading, so it stays one line in a terminal too: the words, a
 * `Count` of what the section holds and a `Note`, all inside `Title`. A
 * section that folds starts its title with a `Fold`, `Fold-open` while its
 * body shows; what a press on it does, and whether the body is drawn, are the
 * caller's. A `Note-refused` says what went wrong there.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A section. */
export let Section:
  & Part
  & Record<'Title' | 'Count' | 'Note' | 'Fold', Part> = block(
    'section',
    'Section',
    {
      Title: 'h2',
      Count: 'span',
      Note: 'span',
      Fold: 'button',
    },
  )

/** A blank line after it, as the margin after it in a browser; a fold is its
 * caret. */
export let sheet = (c: Colors): Sheet => ({
  Section: { gap: true },
  Section_Title: { fg: c.green },
  Section_Count: { fg: c.dim },
  Section_Note: { fg: c.dim },
  'Section_Note-refused': { fg: c.red },
  Section_Fold: { glyph: '▸', fg: c.dim },
  'Section_Fold-open': { glyph: '▾' },
})

let { Title, Count, Note, Fold } = Section

/** An open section, and a folded one. */
export let specimens = (): Specimen[] => [
  [
    'Section, Title, Count, Note',
    h(
      Section,
      {},
      h(
        Title,
        {},
        'Properties',
        h(Count, {}, '4'),
        h(Note, {}, 'declared by @yaks/task'),
      ),
      h('p', null, 'What the section holds.'),
    ),
  ],
  [
    'Section, Title, Note-refused',
    h(
      Section,
      {},
      h(Title, {}, 'Links', h(Note, { mod: 'refused' }, "no entity 'T-0'")),
    ),
  ],
  [
    'Fold, Fold-open',
    h(
      'div',
      null,
      h(
        Section,
        {},
        h(
          Title,
          {},
          h(Fold, { type: 'button', mod: 'open', 'aria-label': 'fold' }),
          'Open',
        ),
        h('p', null, 'Its body shows.'),
      ),
      h(
        Section,
        {},
        h(
          Title,
          {},
          h(Fold, { type: 'button', 'aria-label': 'unfold' }),
          'Folded',
          h(Count, {}, '12'),
        ),
      ),
    ),
  ],
]
