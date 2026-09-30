/**
 * The inspector's own state, as it lives in the page's own graph
 * (./front.json): read through `io.state`, changed by the patches built here
 * and written through `io.set`. One entity, `inspect`, holds the page's
 * (`inspector`: the detail, the pane with the keys, a note open, a delete
 * armed, where a write was refused); each table holds its own (`table`: its
 * order and page).
 *
 * @module
 */

import type { Host as Editing } from '@yaks/editors'
import type { Bundle, Host, Io } from './host.ts'
import { comp } from './read.ts'

/** The entity the page's state is on. */
export let INSPECT = 'inspect'

/** The page's state. */
export type Inspector = {
  detail?: string | null
  pane?: 'index' | 'page' | 'detail' | null
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
 * put({ detail: 'e1' })
 * // [{ entity: { eid: 'inspect' }, inspector: { detail: 'e1' } }]
 * ```
 */
export let put = (patch: Inspector): Bundle[] => [{
  entity: { eid: INSPECT },
  inspector: patch,
}]

/** The entity beside the page is `eid`. */
export let picked = (eid: string): Bundle[] => put({ detail: eid })

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

/** The editors' host (@yaks/editors) over the inspector's: a value changed
 * where it stands goes out through `host.apply`, and, like any write here, a
 * refusal is said in the head of the entity it was about until a write
 * lands. `find` is the server search a picker's candidates come from, and
 * `fields` the page's query fields. */
export let editing = (
  host: Host,
  more: Pick<Editing, 'find' | 'fields'>,
): Editing => {
  let set = (change: Bundle[]) => void host.front.mutate(change)
  return {
    ...host,
    ...more,
    apply: async (change) => {
      await host.apply(change)
      set(put({ said: null, at: null }))
    },
    problem: (said, at) => set(put({ said, at })),
  }
}
