import type { Held } from './build-door.ts'
import type { operatorStore } from './operator-store.ts'

type Store = ReturnType<typeof operatorStore>
type Owner = Pick<Held, 'person' | 'space'>

// What ownership is read by. A session's row is never read whole: its status
// is computed over its transcript.
const OWNING = [
  'spawned',
  'operator_session',
  'operator_request',
  'operator_ask',
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
