/**
 * The inspector's own state, as it lives in the page's own graph
 * (./front.json): read through `io.state`, changed by the patches built here
 * and written through `io.set`. One entity, `inspect`, holds the page's
 * (`inspector`: the pane with the keys, a note open, a delete armed, where a
 * write was refused); each table holds its own (`table`: its order and
 * page); and the stack of panes the page shows is a @yaks/ux `Stack` of its
 * own (`STACK`), each pane an address's (./where.ts).
 *
 * @module
 */

import { type Host as Ux, stackAt, stacked } from '@yaks/ux'
import type { Bundle, Host, Io } from './host.ts'
import { comp } from './read.ts'
import { HOME, stackOf } from './where.ts'

/** The entity the page's state is on. */
export let INSPECT = 'inspect'

/** The page's state. */
export type Inspector = {
  pane?: 'index' | 'page' | null
  note?: string | null
  armed?: string | null
  said?: string | null
  at?: string | null
}

/** One table's state. */
export type Grid = { order?: string | null; after?: string[]; rank?: boolean }

/** The page's state, read reactively. */
export let me = (io: Pick<Io, 'state'>): Inspector =>
  comp(io.state(INSPECT), 'inspector') as Inspector

/**
 * A patch to the page's state.
 *
 * ```ts
 * import { put } from './state.ts'
 * put({ pane: 'index' })
 * // [{ entity: { eid: 'inspect' }, inspector: { pane: 'index' } }]
 * ```
 */
export let put = (patch: Inspector): Bundle[] => [{
  entity: { eid: INSPECT },
  inspector: patch,
}]

/** The eid of the page's stack of panes (@yaks/ux `Stack`). */
export let STACK: string = stackAt(INSPECT)

/** The stack as the page's graph holds it: the first page, before any. */
export let stack = (io: Pick<Io, 'state'>): Bundle =>
  io.state(STACK) ?? { entity: { eid: STACK }, Stack: { panes: [HOME] } }

/**
 * The stack after `href` is followed: each pane it names stacked on `b`, an
 * address outside the inspector none.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { panesOf } from '@yaks/ux'
 * import { follow } from './state.ts'
 *
 * let b = { entity: { eid: 's' }, Stack: { panes: ['q='] } }
 * assertEquals(panesOf(follow(b, '/inspect/T-9')), ['q=', 'T-9'])
 * assertEquals(panesOf(follow(b, '/T-9')), ['q='])
 * ```
 */
export let follow = (b: Bundle, href: string): Bundle =>
  (stackOf(href) ?? []).reduce((s, pane) => stacked(s, pane), b)

/** The key of a value, a heading or a table: its parts, spaced. */
export let key = (...parts: string[]): string => parts.join(' ')

/** A table's state, by the id its page gives it. */
export let grid = (io: Pick<Io, 'state'>, id: string): Grid =>
  comp(io.state(id), 'table') as Grid

/** A patch to a table's state. */
export let turned = (id: string, patch: Grid): Bundle[] => [{
  entity: { eid: id },
  table: patch,
}]

/** Why a write from `at` was refused, or nothing. */
export let refusal = (io: Pick<Io, 'state'>, at: string): string =>
  me(io).at == at && me(io).said ? String(me(io).said) : ''

/** Write `change` to the graph from `at`: a refusal is said there until a
 * write from anywhere lands. */
export let write = (
  io: Pick<Io, 'apply' | 'set'>,
  at: string,
  change: Bundle[],
): Promise<void> =>
  Promise.resolve()
    .then(() => io.apply(change))
    .then(
      () => io.set(put({ said: null, at: null })),
      (err) =>
        io.set(put({
          said: err instanceof Error ? err.message : String(err),
          at,
        })),
    )

/** The UX components' host (@yaks/ux) over the inspector's: a value changed
 * where it stands is written like any write here, a refusal said in the head
 * of the entity it was about until a write lands, and so is input its `Edit`
 * could not read (a `Refused` event). The page's graph is the inspector's
 * own; `find` is the server search a picker's candidates come from, `fields`
 * the page's query fields, `drafts` where what is typed waits, and `Float`
 * where a picker floats. */
export let editing = (
  host: Host,
  more: Pick<Ux, 'find' | 'fields' | 'drafts' | 'Float'>,
): Ux => {
  let set = (change: Bundle[]) => void host.front.mutate(change)
  let { vocab, front, name, id, kind, when } = host
  return {
    vocab,
    front,
    name,
    id,
    kind,
    when,
    ...more,
    write: (b) => {
      let no = b.Refused as { said?: string } | undefined
      return no
        ? set(put({ said: no.said ?? null, at: b.entity.eid }))
        : write({ apply: host.apply, set }, b.entity.eid, [b])
    },
  }
}
