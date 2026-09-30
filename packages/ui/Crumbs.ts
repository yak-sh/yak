/**
 * The way here: one `Crumbs.Item` per step, the last one where you stand.
 * Each step is a link given an `href` (el.ts); the separator between them is
 * the part's own.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h, toChildArray } from 'preact'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Nav: Part & Record<'Item' | 'Sep', Part> = block('nav', 'Crumbs', {
  Item: 'span',
  Sep: 'span',
})

/** The steps, each an `Item`, a separator between each two. */
export let Crumbs: Part & Record<'Item', Part> = Object.assign(
  ({ children, ...p }: Props) =>
    h(
      Nav,
      p,
      toChildArray(children).flatMap((kid, i) =>
        i ? [h(Nav.Sep, { key: `sep${i}` }, '›'), kid] : [kid]
      ),
    ),
  { Item: Nav.Item },
)

/** What it is, in a line. */
export let description =
  'The way here, a step at a time, the last one where you stand.'

/** Dim steps a space apart, and the last one ink. */
export let sheet = (c: Colors): Sheet => ({
  Crumbs: { fg: c.dim, spaced: true },
  Crumbs_Sep: { fg: c.dim },
  'Crumbs_Item-here': { fg: c.text },
})

/** Three steps, the last one here. */
export let specimens = (): Specimen[] => [
  [
    'Crumbs, Item, Item-here',
    h(
      Crumbs,
      {},
      h(Crumbs.Item, { href: '#inspect' }, 'inspect'),
      h(Crumbs.Item, { href: '#task' }, 'task'),
      h(Crumbs.Item, { mod: 'here' }, 'task.status'),
    ),
  ],
]
