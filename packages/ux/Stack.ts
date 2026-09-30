/**
 * `Stack`: panes stacked as a person goes. Each one gone to is stacked on
 * top; each one under it narrows to a strip at its left that says what it
 * is, and a press on a strip returns to that pane, closing those above it.
 * Past `LIMIT` the oldest leave (a browser's history still has them).
 *
 * It is controlled by a bundle and emits one of the same shape: the entity
 * carrying its state, `Stack{panes}` (./vocab.json), the panes bottom first,
 * each the key its owner draws it by. A strip pressed emits the bundle cut
 * back to that pane. Going somewhere is the owner's (a link followed, a row
 * pressed), and `stacked` is the bundle it writes. The owner says where the
 * bundle goes (`onChange`): the page's graph, and a browser's address too.
 *
 * What a pane shows on top, and what its strip says, are the owner's
 * (`Pane`, `Strip`); the look is @yaks/ui's `Stack`.
 *
 * @module
 */

import { type FunctionComponent, h, type JSX } from 'preact'
import { type Bundle, derivedEid } from '@yaks/graph'
import { Stack as Look } from '@yaks/ui'

/**
 * How many panes a stack holds: the top one and five strips. A strip is a
 * spine 2.25rem wide in a browser and three columns in a terminal, so five
 * cost what a narrow nav does and leave the top pane most of a laptop's
 * window and of a 120-column terminal. Further back than five, a person
 * reaches for back or the index, not a strip.
 */
export let LIMIT = 6

/** The eid of the stack `owner` keeps: the same every time it is asked, so
 * a remount finds its state again.
 *
 * ```ts
 * import { assertEquals, assertNotEquals } from '@std/assert'
 * import { stackAt } from '@yaks/ux'
 *
 * assertEquals(stackAt('inspect'), stackAt('inspect'))
 * assertNotEquals(stackAt('inspect'), stackAt('card'))
 * ```
 */
export let stackAt = (owner: string): string =>
  derivedEid(['Stack', owner].join('|'))

/** The panes a stack's bundle holds, bottom first. */
export let panesOf = (e?: Bundle): string[] => {
  let panes = (e?.Stack as { panes?: unknown } | undefined)?.panes
  return Array.isArray(panes) ? panes.map(String) : []
}

// `e` holding `panes`: the bundle a stack emits.
let holding = (e: Bundle, panes: string[]): Bundle => ({
  entity: { eid: e.entity.eid },
  Stack: { panes },
})

/**
 * `e` with `pane` stacked on top, the oldest leaving past `limit`. The pane
 * already on top is not stacked again.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { panesOf, stacked } from '@yaks/ux'
 *
 * let e = { entity: { eid: 's' }, Stack: { panes: ['a', 'b'] } }
 * assertEquals(panesOf(stacked(e, 'c')), ['a', 'b', 'c'])
 * assertEquals(panesOf(stacked(e, 'b')), ['a', 'b'])
 * assertEquals(panesOf(stacked(e, 'c', 2)), ['b', 'c'])
 * ```
 */
export let stacked = (e: Bundle, pane: string, limit = LIMIT): Bundle => {
  let panes = panesOf(e)
  return holding(
    e,
    panes.at(-1) == pane ? panes : [...panes, pane].slice(-limit),
  )
}

/**
 * `e` cut back to its `i`th pane, those above it closed.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { cut, panesOf } from '@yaks/ux'
 *
 * let e = { entity: { eid: 's' }, Stack: { panes: ['a', 'b', 'c'] } }
 * assertEquals(panesOf(cut(e, 0)), ['a'])
 * ```
 */
export let cut = (e: Bundle, i: number): Bundle =>
  holding(e, panesOf(e).slice(0, i + 1))

/** What a stack is drawn with. */
export type StackProps = {
  /** the entity carrying its `Stack{panes}` */
  e: Bundle
  /** where the bundle it emits goes */
  onChange: (b: Bundle) => void
  /** what a pane shows on top */
  Pane: FunctionComponent<{ pane: string }>
  /** what its strip says of a pane under the top one: its name, its kind
   * (@yaks/ui `Stack.Name`, `Stack.Kind`) */
  Strip: FunctionComponent<{ pane: string }>
  /** the top pane has the keyboard */
  on?: boolean
}

/** The panes, the top one drawn and a strip for each under it. */
export let Stack = (
  { e, onChange, Pane, Strip, on }: StackProps,
): JSX.Element => {
  let panes = panesOf(e)
  let top = panes.length - 1
  return h(
    Look,
    {},
    panes.slice(0, -1).map((pane, i) =>
      h(
        Look.Strip,
        {
          key: `${i} ${pane}`,
          type: 'button',
          onClick: () => onChange(cut(e, i)),
        },
        h(Strip, { pane }),
      )
    ),
    top < 0 ? null : h(
      Look.Pane,
      { key: `${top} ${panes[top]}`, mod: on && 'on' },
      h(Pane, { pane: panes[top] }),
    ),
  )
}
