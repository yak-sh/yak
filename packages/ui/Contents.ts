/**
 * What is on this page, as a list of its sections: an entry each, linking to
 * its section's anchor, the section in view wearing `Link-on` (and
 * `aria-current="location"`). It is drawn twice from the same entries: a
 * `List` for a column beside the page, and a `Menu`, a fold under one "On
 * this page" line, for a phone, which shows one of the two by its width.
 *
 * `contents(entries)` draws it from entries the caller has. Given none and a
 * `from` selector instead, it is an empty frame the browser fills from the
 * headings the selector names (@yaks/ui/contents `fill`). Lighting the entry
 * in view is the browser's too (@yaks/ui/contents `watch`).
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h, type VNode } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A table of contents. */
export let Contents:
  & Part
  & Record<
    'Label' | 'List' | 'Item' | 'Link' | 'Menu' | 'Summary',
    Part
  > = block('nav', 'Contents', {
    Label: 'p',
    List: 'ul',
    Item: 'li',
    Link: 'a',
    Menu: 'details',
    Summary: 'summary',
  })

/** One section: the anchor it is at, and its heading's words. A `sub` one
 * is a section within the one before it. */
export type Entry = { id: string; label: string; sub?: boolean }

/** What a contents list is drawn from: its entries, or the selector of the
 * headings the browser makes them from; `on` is the entry lit. */
export type Drawn = {
  entries?: Entry[]
  from?: string
  on?: string
  label?: string
  class?: string
}

let list = (entries: Entry[], on?: string) =>
  h(
    Contents.List,
    {},
    entries.map((e) =>
      h(
        Contents.Item,
        { key: e.id, mod: e.sub && 'sub' },
        h(Contents.Link, {
          href: `#${e.id}`,
          mod: e.id == on && 'on',
          'aria-current': e.id == on ? 'location' : undefined,
        }, e.label),
      )
    ),
  )

/** The contents of a page, drawn from its sections. */
export let contents = (
  { entries = [], from, on, label = 'On this page', ...at }: Drawn,
): VNode =>
  h(
    Contents,
    {
      class: at.class,
      'aria-label': label,
      'data-contents': from ?? '',
      hidden: from && !entries.length ? true : undefined,
    },
    h(Contents.Label, {}, label),
    list(entries, on),
    h(
      Contents.Menu,
      {},
      h(Contents.Summary, {}, label),
      list(entries, on),
    ),
  )

/** What it is, in a line. */
export let description =
  'What is on this page, the section in view lit, a jump to any of it.'

/** A link a line, quiet until it is the section in view. */
export let sheet = (c: Colors): Sheet => ({
  Contents_Label: { bold: true },
  Contents_Link: { block: true, fg: c.muted },
  'Contents_Link-on': { fg: c.text, bold: true },
  'Contents_Item-sub': { indent: 2 },
  Contents_Menu: { hidden: true },
})

/** Parts of this guide, the second in view, and one within it. */
export let specimens = (): Specimen[] => [
  [
    'Contents, Label, List, Item, Item-sub, Link, Link-on, Menu, Summary',
    contents({
      on: 'SideNav',
      entries: [
        { id: 'Tabs', label: 'Tabs' },
        { id: 'SideNav', label: 'SideNav' },
        { id: 'Contents', label: 'Contents', sub: true },
        { id: 'Card', label: 'Card' },
      ],
    }),
  ],
]
