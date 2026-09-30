/**
 * Things to browse, in groups: each `Catalog.Group` under its `Heading`, and
 * each thing a `Catalog.Entry`, its `Title`, a `Sub` saying what it is, then
 * whatever the caller shows of it (a `Gallery`, say). There is room between
 * entries, and more between groups. An entry or a group given an `id` is a
 * place a link can jump to; the entry jumped to lights its title.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Chip } from './Chip.ts'

/** A catalog. */
export let Catalog:
  & Part
  & Record<'Group' | 'Heading' | 'Entry' | 'Title' | 'Sub', Part> = block(
    'div',
    'Catalog',
    {
      Group: 'section',
      Heading: 'h2',
      Entry: 'section',
      Title: 'h3',
      Sub: 'p',
    },
  )

/** What it is, in a line. */
export let description =
  'Things to browse, in groups: each one named, saying what it is, and shown.'

/** A blank line after each group, its heading, each entry and what it is;
 * the heading in the heading colour, a title in ink, what it is muted and
 * folded to the width, as a browser wraps it. */
export let sheet = (c: Colors): Sheet => ({
  Catalog_Group: { gap: true },
  Catalog_Heading: { fg: c.heading, bold: true, gap: true },
  Catalog_Entry: { gap: true },
  Catalog_Title: { fg: c.text, bold: true },
  Catalog_Sub: { fg: c.muted, wrap: true, gap: true },
})

let { Group, Heading, Entry, Title, Sub } = Catalog

/** One group of two entries. */
export let specimens = (): Specimen[] => [
  [
    'Catalog, Group, Heading, Entry, Title, Sub',
    h(
      Catalog,
      {},
      h(
        Group,
        {},
        h(Heading, {}, 'Components'),
        h(
          Entry,
          {},
          h(Title, {}, 'task'),
          h(Sub, {}, 'A thing to do.'),
          h('div', {}, h(Chip, { mod: '1' }, 'task')),
        ),
        h(
          Entry,
          {},
          h(Title, {}, 'doc'),
          h(Sub, {}, 'A title and a body.'),
          h('div', {}, h(Chip, { mod: '0' }, 'doc')),
        ),
      ),
    ),
  ],
]
