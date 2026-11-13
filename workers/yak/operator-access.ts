import type { Bundle, Graph, ReadOpts } from '@yaks/graph'
import { draftEid } from '@yaks/draft'
import type { Meta } from '@yaks/sqlite'
import { absent, and, eq, or } from '@yaks/query/core'
import { MADE, ON, OWNED, OWNERS } from './operator-owner.ts'
import type { Held } from './build-door.ts'
import type { OperatorStore } from './operator-store.ts'
import { spaceOf } from './operator-root.ts'

type Store = OperatorStore
type Owner = Pick<Held, 'person' | 'space'>

// What ownership is read by. A session's row is never read whole: its status
// is computed over its transcript.
const OWNING = [
  'spawned',
  'entry',
  'operator_session',
  'operator_request',
  'wake',
  'call',
  'result',
  'output',
  'task',
  'tombstone',
]

// Ownership comes from the stored request, session, or wake (a wake-up or a
// subscription), including the parent a helper works for. An id, including a
// derived conversation id, grants none.
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
  let owner = (row.operator_session ?? row.operator_request) as
    | Owner
    | undefined
  if (owner?.person && owner.space) return owner
  // A wake is the person's it is set for, in the store's one space.
  let set = (row.wake as { for?: string } | undefined)?.for
  let space = set && await spaceOf(store)
  if (set && space) return { person: set, space }
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

/** What `person` reads the Operator's store with: what is another person's
 * there is out of sight, wherever a read reaches it from, and the memories,
 * tasks and persona nobody owns stay in view. A store whose owners are not
 * all written yet is read by the paths they are named on. */
export let sight = (
  store: { g: Graph; marks?: Pick<Meta, 'get'> },
  person: string,
): ReadOpts => ({
  visibility: { entity: owned(store) ? theirs(person) : claimed(person) },
})

/** The Operator's store as `person` reads it (`sight`). Only its reads are
 * narrowed; a write goes to the store as it stands. */
export let seenBy = (
  store: { g: Graph; marks?: Pick<Meta, 'get'> },
  person: string,
): Graph => {
  let { g } = store
  let { visibility } = sight(store, person)
  let narrow = (opts?: ReadOpts): ReadOpts => ({ ...opts, visibility })
  return {
    ...g,
    read: (query, opts) => g.read(query, narrow(opts)),
    rows: (query, opts) => g.rows(query, narrow(opts)),
    get: (eids, comps, opts) => g.get(eids, comps, narrow(opts)),
    view: (query, opts) => g.view(query, narrow(opts)),
  }
}

/** A write a person may not make, answered 403 (@yaks/graph `STATUS`). */
export class Denied extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Denied'
  }
}

/** Whether `place` keeps a draft of `who`'s: their conversation, a new one,
 * or one of theirs by its key (`operator:<conversation>`). */
export let placed = async (store: Store, place: string, who: Owner) =>
  place == 'operator' || place == 'operator:new' ||
  place.startsWith('operator:') &&
    await owns(store, place.slice('operator:'.length), who)

// Whether a bundle carries nothing beside its entity, its writer, its
// preconditions and these components.
let only = (b: Bundle, ...names: string[]) =>
  Object.keys(b).every((k) =>
    k == 'entity' || k == '$actor' || k == '$was' || names.includes(k)
  )

/**
 * What `who` may write to the Operator's store themselves, the rest of it
 * being the Operator's to write: their own draft (@yaks/draft, at its eid for
 * them and its place) where it is theirs to keep (`placed`), and the archive
 * mark on a line of a conversation of theirs. Anything else refuses the whole
 * batch, alike whether what it names is there or not.
 */
export let mayWrite = async (store: Store, who: Owner, bundles: Bundle[]) => {
  let one = async (b: Bundle) => {
    let draft = b.draft as { by?: unknown; place?: unknown } | undefined
    if (draft && only(b, 'draft', 'typed')) {
      let place = String(draft.place ?? '')
      return draft.by == who.person &&
        b.entity.eid == draftEid(who.person, place) &&
        await placed(store, place, who)
    }
    if (b.archived !== undefined && only(b, 'archived')) {
      let [line] = await store.g.get([b.entity.eid], ['entry'])
      return !!line?.entry && await owns(store, b.entity.eid, who)
    }
    return false
  }
  if (!(await Promise.all(bundles.map(one))).every(Boolean)) {
    throw new Denied(
      'Only your own drafts, and the archive marks on the lines of your own ' +
        'conversations, are yours to write here.',
    )
  }
}
