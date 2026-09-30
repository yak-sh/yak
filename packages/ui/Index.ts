/**
 * An index: groups of entries, each `Index.Group` a `Head` naming the group
 * and an `Item` per entry under it, every one a link. The entry or group
 * where you are wears `Item-on` or `Head-on`; `Item-hover` is the one under
 * the pointer. Nothing in it folds: an index shows every entry it is given.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** An index. */
export let Index: Part & Record<'Group' | 'Head' | 'Item', Part> = block(
  'nav',
  'Index',
  { Group: 'div', Head: 'a', Item: 'a' },
)

/** Each head and entry a line of its own, the entries indented under their
 * head; where you are in the accent. */
export let sheet = (c: Colors): Sheet => ({
  Index_Head: { block: true, fg: c.heading },
  'Index_Head-on': { fg: c.accent, bold: true },
  Index_Item: { block: true, indent: 2, fg: c.muted },
  'Index_Item-on': { fg: c.accent, bold: true },
  'Index_Item-hover': { fg: c.text },
})

let { Group, Head, Item } = Index

/** Two groups, one entry where you are and one under the pointer. */
export let specimens = (): Specimen[] => [
  [
    'Index, Group, Head, Item, Item-on, Item-hover',
    h(
      Index,
      {},
      h(
        Group,
        {},
        h(Head, { href: '#task' }, '@yaks/task'),
        h(Item, { href: '#blocked' }, 'blocked'),
        h(Item, { href: '#task', mod: 'on' }, 'task'),
      ),
      h(
        Group,
        {},
        h(Head, { href: '#doc' }, '@yaks/doc'),
        h(Item, { href: '#doc', mod: 'hover' }, 'doc'),
      ),
    ),
  ],
]
