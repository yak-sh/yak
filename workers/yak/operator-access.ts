import type { Graph, ReadOpts } from '@yaks/graph'
import { absent, and, eq, or } from '@yaks/query/core'
import type { Held } from './build-door.ts'
import type { operatorStore } from './operator-store.ts'

type Store = ReturnType<typeof operatorStore>
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

// What a person owns in the Operator's store, by the component that names
// them: their conversations and the sessions working for them, their
// requests, the wake-ups and subscriptions they set, the letters and texts
// sent for them, what they were told, and their drafts.
const OWNED: [string, string][] = [
  ['operator_session', 'person'],
  ['operator_request', 'person'],
  ['operator_ask', 'person'],
  ['operator_letter', 'person'],
  ['operator_text', 'person'],
  ['operator_contact', 'person'],
  ['context_output', 'reader'],
  ['deliver', 'to'],
  ['draft', 'by'],
]
// And what is theirs by what it hangs on: a helper's session by the session
// it works for, an entry by its session, the files that came with a request
// by the request.
const ON = [
  'spawned.parent.',
  'entry.session.',
  'entry.session.spawned.parent.',
  'operator_files.request.',
]
// The entities `person` may read: each names nobody else as its owner, here
// or on what it hangs on.
let theirs = (person: string) =>
  and(
    ...['', ...ON].flatMap((at) =>
      OWNED.map(([name, by]) =>
        or(absent(`${at}${name}`), eq(`${at}${name}.${by}`, person))
      )
    ),
    or(
      and(absent('call'), absent('result'), absent('output')),
      absent('created.via.operator_session'),
      eq('created.via.operator_session.person', person),
    ),
  )

/** The Operator's store as `person` reads it: what is another person's
 * there is out of sight, wherever a read reaches it from. The memories, tasks
 * and persona nobody owns stay in view. Only its reads are narrowed; a write
 * goes to the store as it stands. */
export let seenBy = (g: Graph, person: string): Graph => {
  let visibility = { entity: theirs(person) }
  let narrow = (opts?: ReadOpts): ReadOpts => ({ ...opts, visibility })
  return {
    ...g,
    read: (query, opts) => g.read(query, narrow(opts)),
    rows: (query, opts) => g.rows(query, narrow(opts)),
    get: (eids, comps, opts) => g.get(eids, comps, narrow(opts)),
    view: (query, opts) => g.view(query, narrow(opts)),
  }
}
