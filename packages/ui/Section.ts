/**
 * A titled section of a page: its `Title` line, then a `Sub` saying what it
 * is about, then what it holds. The title line is one heading, so it stays
 * one line in a terminal too: the words, a `Count` of what the section holds,
 * a `Note`, and anything else the line offers (a button), all inside `Title`.
 * A `Note-refused` says what went wrong there. A section never folds: what it
 * holds shows.
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
  & Record<'Title' | 'Count' | 'Note' | 'Sub', Part> = block(
    'section',
    'Section',
    {
      Title: 'h2',
      Count: 'span',
      Note: 'span',
      Sub: 'p',
    },
  )

/** What it is, in a line. */
export let description =
  'A titled part of a page: what it is about, then what it holds.'

/** A blank line after it, as the margin after it in a browser. */
export let sheet = (c: Colors): Sheet => ({
  Section: { gap: true },
  Section_Title: { fg: c.heading, spaced: true },
  Section_Count: { fg: c.dim, bold: false },
  Section_Note: { fg: c.dim, bold: false },
  'Section_Note-refused': { fg: c.negative },
  Section_Sub: { fg: c.muted },
})

let { Title, Count, Note, Sub } = Section

/** A section with all it says of itself, and one that went wrong. */
export let specimens = (): Specimen[] => [
  [
    'Section, Title, Count, Note, Sub',
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
      h(Sub, {}, 'what a task holds'),
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
]
