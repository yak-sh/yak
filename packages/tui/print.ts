/**
 * A Preact tree painted once, for a command that prints and exits: mounted in
 * the fake document, laid out and colored by the ANSI painter at `columns`
 * wide, then unmounted, with no screen taken and nothing held. Its own entry
 * (`@yaks/tui/print`), so a printout loads the painter without the widgets.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h } from 'preact'
 * import { print } from '@yaks/tui/print'
 *
 * let tree = h('dl', null, h('dt', null, 'size'), h('dd', null, h('b', null, 'big')))
 * assertEquals(print(tree, 40), 'size: \x1b[1mbig\x1b[0m')
 * ```
 *
 * @module
 */

import { type ComponentChild, render } from 'preact'
import { install } from './dom.ts'
import { printout } from './paint.ts'
import type { Sheet } from './theme.ts'

/** The text a terminal prints for `node`; `sheet` extends the theme. */
export let print = (
  node: ComponentChild,
  columns: number,
  sheet: Sheet = {},
): string => {
  let screen = install()
  let root = screen.root as unknown as Parameters<typeof render>[1]
  try {
    render(node, root)
    return printout(screen.root, columns, sheet)
  } finally {
    render(null, root)
    screen.free()
  }
}
