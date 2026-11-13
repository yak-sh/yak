import type { Graph, ReadOpts } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { absent, and, eq, or } from '@yaks/query/core'
import { MADE, ON, OWNED, OWNERS } from './operator-owner.ts'
import type { Held } from './build-door.ts'
import type { OperatorStore } from './operator-store.ts'

type Store = OperatorStore
type Owner = Pick<Held, 'person' | 'space'>

// What ownership is read by. A session's row is never read whole: its status
// is computed over its transcript.
const OWNING = [
  'spawned',
  'entry',
  'operator_session',
  'operator_request',
  'operator_ask',
  'call',
  'result',
  'output',
  'task',
  'tombstone',
]

// Ownership comes from the stored request, session, wake-up or subscription,
// including the parent a helper works for. An id, including a derived
// conversation id, grants none.
export let ownerOf = async (
  store: Store,
  open: string,
  seen = new Set<string>(),
): Promise<Owner | undefined> => {
  if (seen.has(open)) return
  seen.add(open)
  let [row] = await store.g.get([open], OWNING)
  if (!row) return
  if (row.spawned) {
    return ownerOf(
      store,
      String((row.spawned as { parent: string }).parent),
      seen,
    )
  }
  if (row.entry) {
    return ownerOf(
      store,
      String((row.entry as { session: string }).session),
      seen,
    )
  }
  let source = (row.call as { source?: string } | undefined)?.source ??
    (row.result as { call?: string } | undefined)?.call ??
    (row.output as { source?: string } | undefined)?.source
  if (source) return ownerOf(store, source, seen)
  let owner = (row.operator_session ?? row.operator_request ??
    row.operator_ask) as Owner | undefined
  if (owner?.person && owner.space) return owner
  // A task is its sessions' owner's, and a deleted wake-up or subscription
  // the owner's of the requests it fired, when they all agree.
  let by = row.task
    ? await sessionsIn(store, open)
    : row.tombstone
    ? await store.g.read(`.operator_request.about=${open}`)
    : []
  let owners = await Promise.all(
    by.map((b) => ownerOf(store, b.entity.eid, new Set(seen))),
  )
  let first = owners[0]
  return first &&
      owners.every((o) => o?.person == first.person && o.space == first.space)
    ? first
    : undefined
}

// The sessions a task holds, by the links it keeps to them.
let sessionsIn = async (store: Store, task: string) => {
  let to = (await store.g.read(`.contains .edge.from=${task}`))
    .map((b) => String((b.edge as { to: string }).to))
  return to.length
    ? await store.g.read(
      `.entity.eid=${to.join(',')}&.session&.fields=entity.eid`,
    )
    : []
}

export let owns = async (store: Store, open: string, who: Owner) => {
  let owner = await ownerOf(store, open)
  return !!owner && owner.person == who.person && owner.space == who.space
}

// The entities `person` may read, by the paths an owner is named on: each
// names nobody else, here or on what it hangs on (operator-owner.ts). A store
// is read by this only until every entity's owner is written there.
let claimed = (person: string) =>
  and(
    ...['', ...ON].flatMap((at) =>
      OWNED.map(([name, by]) =>
        or(absent(`${at}${name}`), eq(`${at}${name}.${by}`, person))
      )
    ),
    or(
      and(...MADE.map((c) => absent(c))),
      absent('created.via.operator_session'),
      eq('created.via.operator_session.person', person),
    ),
  )

// The same entities, by the owner each keeps: theirs, or nobody's.
let theirs = (person: string) =>
  and(or(absent('owner'), eq('owner.person', person)))

// A store seen to have every owner written, which never goes back.
let written = new WeakSet<Graph>()

/** Whether `store` keeps every entity's owner: once its marks say the pass
 * has written them (operator-owner.ts `OWNERS`), and always for a store kept
 * nowhere, which is made in memory with the rule. */
export let owned = (store: { g: Graph; marks?: Pick<Meta, 'get'> }) => {
  if (written.has(store.g)) return true
  if (store.marks && store.marks.get(OWNERS) != 'done') return false
  written.add(store.g)
  return true
}

/** The Operator's store as `person` reads it: what is another person's
 * there is out of sight, wherever a read reaches it from. The memories, tasks
 * and persona nobody owns stay in view. Only its reads are narrowed; a write
 * goes to the store as it stands. A store whose owners are not all written
 * yet is read by the paths they are named on. */
export let seenBy = (
  store: { g: Graph; marks?: Pick<Meta, 'get'> },
  person: string,
): Graph => {
  let { g } = store
  let visibility = {
    entity: owned(store) ? theirs(person) : claimed(person),
  }
  let narrow = (opts?: ReadOpts): ReadOpts => ({ ...opts, visibility })
  return {
    ...g,
    read: (query, opts) => g.read(query, narrow(opts)),
    rows: (query, opts) => g.rows(query, narrow(opts)),
    get: (eids, comps, opts) => g.get(eids, comps, narrow(opts)),
    view: (query, opts) => g.view(query, narrow(opts)),
  }
}
