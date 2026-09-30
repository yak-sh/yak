/**
 * What an `Edit` keeps and says, as bundles: pure. Its own state is the `Edit`
 * component (./vocab.json) on an entity of its own in the page's graph, whose
 * eid is derived from its owner and the value it changes, so a remount finds
 * it again; each change to that state is a patch built here. What is typed
 * over a value is the person's draft, in the place named for the value alone
 * (`place`), so every view of it, in every interface, types on from the same
 * text. What it emits is a bundle of the shape it was handed (the value,
 * changed), or, the exception, an event bundle: `Refused`, input that could
 * not be read.
 *
 * @module
 */

import { type Bundle, derivedEid } from '@yaks/graph'

/** What the `Edit` component holds. */
export type Row = {
  /** being changed: typed over in place, or its picker floating beside it */
  open?: boolean
  /** what is typed in its picker's search */
  query?: string
}

/** The eid of the `Edit` that changes `comp.prop` of `eid` for `owner`: the
 * same every time it is asked, so a remount finds its state again.
 *
 * ```ts
 * import { assertEquals, assertNotEquals } from '@std/assert'
 * import { at } from '@yaks/ux'
 *
 * assertEquals(at('', 'e1', 'doc', 'title'), at('', 'e1', 'doc', 'title'))
 * assertNotEquals(at('card', 'e1', 'doc', 'title'), at('', 'e1', 'doc', 'title'))
 * ```
 */
export let at = (
  owner: string,
  eid: string,
  comp: string,
  prop: string,
): string => derivedEid(['Edit', owner, eid, `${comp}.${prop}`].join('|'))

/** The place the person's draft of `comp.prop` of `eid` is typed in: the
 * value's own, whichever view or interface types over it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { place } from '@yaks/ux'
 *
 * assertEquals(place('e1', 'doc', 'title'), 'edit:e1:doc.title')
 * ```
 */
export let place = (eid: string, comp: string, prop: string): string =>
  `edit:${eid}:${comp}.${prop}`

/** A patch to an `Edit`'s state; `null` closes it, leaving nothing behind.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { put } from '@yaks/ux'
 *
 * assertEquals(put('x', { open: true }), [{ entity: { eid: 'x' }, Edit: { open: true } }])
 * assertEquals(put('x', null), [{ entity: { eid: 'x' }, Edit: null }])
 * ```
 */
export let put = (eid: string, patch: Row | null): Bundle[] => [{
  entity: { eid },
  Edit: patch,
}]

/** A value as the text it is typed over as: a JSON value as its JSON text.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { source } from '@yaks/ux'
 *
 * assertEquals([source(null), source(3), source({ a: 1 })], ['', '3', '{"a":1}'])
 * ```
 */
export let source = (v: unknown): string =>
  v == null ? '' : typeof v == 'object' ? JSON.stringify(v) : String(v)

/** The value `comp.prop` of `e` holds. */
export let valueOf = (
  e: Bundle | undefined,
  comp: string,
  prop: string,
): unknown => {
  let row = e?.[comp]
  return row && typeof row == 'object'
    ? (row as Record<string, unknown>)[prop]
    : undefined
}

/** `e`, its `comp.prop` changed to `value`: the bundle an `Edit` emits.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { changed } from '@yaks/ux'
 *
 * let e = { entity: { eid: 'e1', num: 3 }, doc: { title: 'Draft', body: 'b' } }
 * assertEquals(changed(e, 'doc', 'title', 'Ship it'), {
 *   entity: { eid: 'e1' },
 *   doc: { title: 'Ship it' },
 * })
 * ```
 */
export let changed = (
  e: Bundle,
  comp: string,
  prop: string,
  value: unknown,
): Bundle => ({ entity: { eid: e.entity.eid }, [comp]: { [prop]: value } })

/** The event an `Edit` emits when what was typed could not be read: on the
 * entity the value belongs to, saying why. */
export let refused = (e: Bundle, said: string): Bundle => ({
  entity: { eid: e.entity.eid },
  Refused: { said },
})
