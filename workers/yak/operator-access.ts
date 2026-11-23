import { line } from '@yaks/query'
import {
  type Bundle,
  comps,
  type Eid,
  type Graph,
  isAlias,
  type ReadOpts,
} from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { unnamed } from '@yaks/id'
import { draftEid } from '@yaks/draft'
import type { Meta } from '@yaks/sqlite'
import { absent, and, eq, or, pred, present } from '@yaks/query/core'
import { OWNERS, visibleOwner } from '@yaks/platform/operator-owner'
import { MEMORY_OWNERS } from '@yaks/platform/operator-memory'
import type { Held } from './build-door.ts'
import type { Conversing } from '@yaks/harness/conversations'
import type { OperatorStore } from './operator-store.ts'
import { spaceOf } from './operator-root.ts'
import { ORACLES } from './oracle-move.ts'
import { inputOf } from '@yaks/session/intake'

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
  'intake',
]

// Ownership comes from the stored request, session, or wake (a wake-up or a
// subscription), including the parent a helper works for, and for an item
// a person's words came in, from the input that took them. An id, including
// a derived conversation id, grants none.
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
  // An item is the person's whose session took its words: the input its id
  // derives, when that input names it (@yaks/session/intake).
  let [input] = await store.g.get([inputOf(open)], ['intake', 'entry'])
  if ((input?.intake as { item?: string } | undefined)?.item == open) {
    return ownerOf(store, input.entity.eid, seen)
  }
  // A task is its sessions' owner's, and a deleted wake-up or subscription
  // the owner's of the requests it fired, when they all agree.
  let by = row.task
    ? await sessionsIn(store, open)
    : row.tombstone
    ? await store.g.read(line`.operator_request.about=${open}`)
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
  let to = (await store.g.read(line`.contains .edge.from=${task}`))
    .map((b) => String((b.edge as { to: string }).to))
  return to.length
    ? await store.g.read(
      line`.entity.eid=${to}&.session&.fields=entity.eid`,
    )
    : []
}

export let owns = async (store: Store, open: string, who: Owner) => {
  let owner = await ownerOf(store, open)
  return !!owner && owner.person == who.person && owner.space == who.space
}

// A store seen to have every owner written, which never goes back.
let written = new WeakSet<Graph>()

/** Whether `store` keeps every entity's owner: once its marks say the pass
 * has written them (@yaks/platform/operator-owner `OWNERS`), and always for a store kept
 * nowhere, which is made in memory with the rule. */
export let owned = (store: { g: Graph; marks?: Pick<Meta, 'get'> }) => {
  if (written.has(store.g)) return true
  if (store.marks && store.marks.get(OWNERS) != 'done') return false
  written.add(store.g)
  return true
}

/** The attachments a person sees of their own in a space: each that came
 * with a request of theirs, an entry of their conversation, the conversation
 * itself, or an item of theirs whose words it took (a letter, a text), kept
 * theirs by its owner (@yaks/blob/attachment `attachmentsSeen`). An owner
 * names only a person, so it is theirs only in the space `store` is. */
export let theirFiles = async (
  store: Pick<Store, 'g'>,
  held: Pick<Held, 'person' | 'space'>,
) =>
  or(
    ...(await spaceOf(store)) == held.space
      ? [eq('attachment.message.owner.person', held.person)]
      : [],
    ...[
      'operator_request',
      'entry.session.operator_session',
      'operator_session',
    ]
      .map((path) =>
        and(
          eq(`attachment.message.${path}.person`, held.person),
          eq(`attachment.message.${path}.space`, held.space),
        )
      ),
  )

// Until the alarm quarantines old projections, hide their topics, links and
// sources through their existing links. Policy relations inspect the underlying
// graph, so hiding a topic cannot make its source appear unlinked and public.
let oracles = (person: string) =>
  or(
    eq('operator_oracle.person', person),
    and(
      absent('operator_oracle'),
      absent('topic'),
      absent('edge.from.topic'),
      absent('edge.to.topic'),
      {
        ...pred('edges_to', '!', null),
        not: true,
        where: and(present('contains'), present('edge.from.topic')),
      },
    ),
  )

/** Who reads the Operator's store: a person, and whether they write in its
 * space (`member`, @yaks/member `writes`). */
export type Reader = { person: string; member: boolean }

/** What `reader` reads the Operator's store with: what is another person's
 * there is out of sight, wherever a read reaches it from. For a member, the
 * memories, tasks and persona nobody owns stay in view, the space's work; for
 * anyone else only what is theirs does, as the space's own tools are none of
 * theirs (operator.ts `operatorRoster`). A store whose owners are not all
 * written yet is read by the paths they are named on. */
export let sight = (
  store: { g: Graph; marks?: Pick<Meta, 'get'> },
  { person, member }: Reader,
): ReadOpts => ({
  visibility: {
    entity: and(
      visibleOwner(person, member, owned(store)),
      ...store.marks?.get(ORACLES) == 'done' ? [] : [oracles(person)],
      ...store.marks && store.marks.get(MEMORY_OWNERS) != 'done'
        ? [
          or(
            absent('memory'),
            present('operator_memory'),
            eq('owner.person', person),
          ),
        ]
        : [],
    ),
  },
})

// Each id a batch names, a bundle's own and every reference's, with the kind
// the reference declares, as the write resolves them (@yaks/graph `apply`).
type Named = {
  i: number
  id: string
  comp?: string
  prop?: string
  kind?: string
}
let naming = (g: Graph, bundles: Bundle[]): Named[] =>
  bundles.flatMap((b, i) => [
    { i, id: b.entity.eid },
    ...comps(b).flatMap(([comp, held]) =>
      Object.entries(held ?? {}).flatMap(([prop, id]) => {
        let p = g.vocab.prop(comp, prop)
        return p?.category == 'ref' && typeof id == 'string'
          ? [{ i, id, comp, prop, kind: p.ref ? String(p.ref) : undefined }]
          : []
      })
    ),
  ]).filter(({ id }) => !isAlias(id))

/** The Operator's store as `reader` reads it (`sight`) and edits its work.
 * A write reaches only what its reader sees: each id it names or references
 * is addressed as the reader reads, so one naming what is out of sight,
 * by number or by eid, is refused as one naming nothing is. What waits on a
 * person's answer is the system's to write, whoever writes here
 * (@yaks/platform/operator-graph `answering`). */
export let seenBy = (
  store: { g: Graph; marks?: Pick<Meta, 'get'> },
  reader: Reader,
): Graph => {
  let { g } = store
  let { visibility } = sight(store, reader)
  let narrow = (opts?: ReadOpts): ReadOpts => ({ ...opts, visibility })
  // The batch with every id it names resolved as the reader sees it.
  let within = async (bundles: Bundle[]) => {
    let named = naming(g, bundles)
    let kinds = Map.groupBy(named, (n) => n.kind)
    let at = new Map<string | undefined, Map<string, Eid>>()
    for (let [kind, ns] of kinds) {
      at.set(kind, await g.address(ns.map((n) => n.id), kind, narrow()))
    }
    let eid = (n: Named) => at.get(n.kind)?.get(n.id) ?? n.id
    let eids = [...new Set(named.map(eid))]
    let [kept, seen] = await Promise.all([
      g.get(eids, []),
      g.get(eids, [], narrow()),
    ])
    let shown = new Set(seen.map((b) => b.entity.eid))
    let hidden = kept.find((b) => !shown.has(b.entity.eid))
    if (hidden) {
      let n = named.find((n) => eid(n) == hidden.entity.eid)!
      throw new Refused(unnamed(n.id, g.vocab))
    }
    let out = [...bundles]
    for (let n of named) {
      if (eid(n) == n.id) continue
      let b = out[n.i]
      out[n.i] = n.comp
        ? { ...b, [n.comp]: { ...b[n.comp] as object, [n.prop!]: eid(n) } }
        : { ...b, entity: { ...b.entity, eid: eid(n) } }
    }
    return out
  }
  return {
    ...g,
    read: (query, opts) => g.read(query, narrow(opts)),
    rows: (query, opts) => g.rows(query, narrow(opts)),
    get: (eids, comps, opts) => g.get(eids, comps, narrow(opts)),
    view: (query, opts) => g.view(query, narrow(opts)),
    address: (ids, kind, opts) => g.address(ids, kind, narrow(opts)),
    apply: async (bundles, opts) => g.apply(await within(bundles), opts),
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
 * them and its place) where it is theirs to keep (`placed`), the archive
 * mark on a line of a conversation of theirs, and the walkthrough mark on the
 * conversation itself (walkthrough.ts). Anything else refuses the whole
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
    if (b.walkthrough !== undefined && only(b, 'walkthrough')) {
      let [root] = await store.g.get([b.entity.eid], ['session'])
      return !!root?.session && await owns(store, b.entity.eid, who)
    }
    return false
  }
  if (!(await Promise.all(bundles.map(one))).every(Boolean)) {
    throw new Denied(
      'Only your own drafts, and the archive marks on the lines of your own ' +
        'conversations and the walkthrough marks on them, are yours to write ' +
        'here. The Operator writes the rest: ask it with operator_chat, or ' +
        'use memory_save, task_new or goal_new; graph_apply without self ' +
        'writes to the apps.',
    )
  }
}

/** Whom @yaks/harness's conversation tools speak for in a space's store,
 * the person its door vouched for, the project they talk in, the space, and
 * what they may read there: what is
 * theirs, or for the platform's admin anything, as operator_read reads. */
export let conversant = (
  store: Store,
  held: Pick<Held, 'person' | 'space' | 'administrative'>,
): Pick<Conversing, 'owner' | 'project' | 'reads'> => ({
  owner: () => Promise.resolve(held.person),
  // The project is the space, whether or not its row is kept here yet.
  project: async (g) =>
    (await g.get([held.space]))[0] ?? {
      entity: { eid: held.space },
      project: {},
    },
  reads: async (_, row) =>
    held.administrative === true || await owns(store, row.entity.eid, held),
})
