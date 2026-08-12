// The browser half: one graph cache, narrow render signals, one socket,
// one identity, one camera. A snapshot fills the cache; patches publish
// only the rows and relationships their renderers hold.
import {
  batch,
  computed,
  type Signal,
  signal,
  untracked,
} from '@preact/signals'
import {
  awake,
  type Change,
  comps as vocab,
  type Dep,
  type Ent,
  type Live,
  type Pinned,
  type Session,
  sessionOf,
  settled,
  SHORT,
  slugsOf,
  type Snapshot,
  stamped,
} from './types.ts'
import { inboxItem, isUnread, readerAt, type Row } from './client.ts'
import {
  listed,
  matchQuery,
  namesLazy,
  parseQuery,
  type Pred,
  resolveRefs,
  scopedSessions,
  warm,
} from './query.ts'
import { anchor, emptyIndex, indexAll, reindex, reindexEdge } from './index.ts'
import { type MemoryResolver, memoryResolver } from './resolver.ts'
import {
  clearIdb,
  type IdbResolver,
  idbResolver,
  openIdb,
  putBags,
  seedIdb,
} from './schema/idb.ts'
import { normalizeChanges } from './props.ts'
import * as idb from './idb.ts'
import { topology } from './leader.ts'
import { liveChanges } from './wire.ts'
import { diff, gaps } from './subs.ts'
import {
  foldObservation,
  type ObservationState,
  observedBy,
  safeObservation,
} from './observations.ts'

// A cache row: the spine plus whichever components the entity carries.
// Derived from Ent so a new component (types.ts) threads through here —
// and through ent() below — with zero edits. Exported so idb.ts persists
// and hydrates the exact shape the signal holds (T-6823).
export type Comps =
  & { entity?: { eid: string; num: number } }
  & Omit<Ent, 'eid' | 'num' | 'kind' | 'refs' | 'kids'>

export let cache = signal<Record<string, Comps>>({})
export let deps = signal<Dep[]>([])
export let problem = signal('')
let pinZs = new Map<string, Signal<number>>()
let rowSignals = new Map<string, Signal<Comps | undefined>>()
let relationSignals = new Map<string, Signal<Dep[]>>()
let childSignals = new Map<string, Signal<Dep[]>>()
export let census = signal<string[]>([])
export let revealed = signal<Set<string>>(new Set())
export let reveal = (eid: string) => {
  revealed.value = new Set([...revealed.peek(), eid])
}
export let shown = (eid: string) =>
  !cache.value[eid]?.quarantined || revealed.value.has(eid)
let canvasVersion = signal(0)
let noRelations: Dep[] = []
let refreshBoards = (_ids: Set<string>) => {}
let refreshPins = (_ids: Set<string>) => {}
let refreshComments = (_ids: Set<string>) => {}
let refreshFolds = (_ids: Set<string>) => {}
let refreshBacklinks = (_ids: Set<string>) => {}
let refreshJobs = (_ids: Set<string>) => {}
let refreshBoardLinks = (_ids: Set<string>) => {}
let refreshFacets = (_ids: Set<string>) => {}

// Human ids are a hot lookup vocabulary, not a query. Keep them beside the
// cache so rendering one reference never scans or subscribes to the graph.
let idGraph = cache.peek()
let numEids = new Map<number, string>()
let aliasEids = new Map<string, string>()
let shortEids = new Map<string, Set<string>>()
// The cache's derived indexes (index.ts) — the reverse `{eid}` views, by-
// component-presence, and edge endpoints, all flowing from the `comps`
// vocabulary. Maintained incrementally by applyLocal/evict below; the query
// layer (queryEids) anchors on it. A wholesale cache/deps replacement (tests,
// host integrations) is healed lazily: ixGraph/ixDeps mark the last-indexed
// refs, so a mismatch rebuilds once rather than per patch.
let ix = emptyIndex()
let ixGraph = cache.peek()
let ixDeps = deps.peek()
let syncIx = () => {
  if (ixGraph != cache.peek() || ixDeps != deps.peek()) {
    indexAll(ix, cache.peek(), deps.peek())
    ixGraph = cache.peek()
    ixDeps = deps.peek()
  }
}

// The reactive query layer — the store-agnostic door for "which entities match
// this query". The mechanics live behind the Resolver seam (resolver.ts): a
// query is a value (Pred[], the query.ts grammar boards and graph_query already
// speak), resolved to a NARROW signal of matching eids. `mem` is the in-memory
// realization: it reads the cache through the store below — its initial fill
// anchors on the derived index (index.ts — O(result), never O(graph)), and
// `refresh` re-tests ONLY the eids each patch touched, so an unrelated patch
// never wakes a subscriber. Never `Object.values(cache.value).filter` in a
// render: that scans the whole graph AND subscribes to every patch (T-17036,
// the 16ms frame budget).
let mem: MemoryResolver = memoryResolver({
  read: (eid) => cache.peek()[eid],
  keys: () => Object.keys(cache.peek()),
  // Heal the derived index before narrowing — the same guard querySet held.
  anchor: (preds) => {
    syncIx()
    return anchor(ix, preds)
  },
})

// The durable query surface (T-17126, slice e of D-17120). Where IndexedDB is
// present (the browser), `store` is the store-backed idbResolver (schema/idb.ts)
// and queryEids reads THROUGH it — the generated per-component indexes answer a
// query, not the in-memory mirror. The mirror (cache) STAYS: ~90 sites still
// scan it directly (T-17064, held off so this diff owns live.ts), and it is this
// resolver's SYNCHRONOUS prime (mem.resolve — anchored, O(result)) so a board
// paints on the frame it mounts rather than empty-then-filled. Absent IDB (the
// TUI, private mode, a blocked upgrade) `store` stays null and `mem` drives
// queries exactly as before — the seam's whole point, no call-site churn.
let store: IdbResolver | null = null
let storeDb: IDBDatabase | null = null
// During a wholesale (re)seed the per-row mirror below is skipped — resetQueries
// writes the whole graph in one bulk pass instead of one put per change.
let seeding = false

// All durable-store work runs on one chain, in order: a mirror's write settles
// before its refresh reads, and a reset's clear+seed can't interleave with a
// live frame's put. The signal fills on settle — the async bridge the seam
// documents — so the frame is never blocked on IDB.
let storeWork = Promise.resolve()
let queueStore = (fn: () => Promise<void>): Promise<void> =>
  storeWork = storeWork.then(fn).catch((e) => {
    console.warn('durable query store —', e)
  })

// Mirror the touched eids into the durable store: an eid absent from the cache
// (deleted/evicted) carries an empty bag, so putBags deletes it from every
// store. Then re-test just those eids against every held query.
let mirror = (eids: string[]) =>
  putBags(
    storeDb!,
    eids.map((eid) => [eid, cache.peek()[eid] ?? {}] as const),
  )

// A patch's touched eids: write them through, then re-test. `mem` still drives
// the signals where there is no durable store (the TUI).
let refreshQueries = (eids: Set<string>) => {
  if (!store) return void mem.refresh(eids)
  if (seeding || !eids.size) return
  let ids = [...eids]
  queueStore(async () => {
    await mirror(ids)
    await store!.refresh(new Set(ids))
  })
}

// A wholesale cache replacement (seed / snapshot reset): clear the store, seed
// the fresh graph, then re-scan every held query from it.
let resetQueries = () => {
  if (!store) return void mem.reset()
  queueStore(async () => {
    await clearIdb(storeDb!)
    await seedIdb(storeDb!, cache.peek())
    await store!.reset()
  })
}

// Read a query's result signal (get-or-create; the render half of the hook).
export let queryEids = (preds: Pred[]): Signal<string[]> =>
  (store ?? mem).subscribe(preds)
// Ref-count a query for a component's lifetime (the hook's effect half); the
// last release drops the set so distinct queries don't accumulate.
export let holdQuery = (preds: Pred[]): Signal<string[]> =>
  (store ?? mem).hold(preds)
export let dropQuery = (preds: Pred[]) => (store ?? mem).drop(preds)

// Open and populate the durable query store, then make it the query surface.
// Awaited inside boot BEFORE the first render, so queryEids never sees a
// half-open store and the first paint has the store's answers (primed from the
// cache). A distinct db name from idb.ts's 'tasks' — that store is the boot
// hydration shadow, this one the query index; two shapes, two databases. Any
// failure leaves `store` null and `mem` in charge — the graceful degrade idb.ts
// already models. Only a socket-owning tab (solo/leader) attaches; a follower
// keeps `mem` so two tabs never contend to write one origin-shared store (the
// multi-writer store is future work, like idb.ts's leader-only write path).
let attachStore = async () => {
  if (store || !config.store) return
  if (!(globalThis as { indexedDB?: IDBFactory }).indexedDB) return
  try {
    let db = await openIdb('tasks-graph')
    storeDb = db
    // Seed the whole graph in the BACKGROUND — boot never blocks on it, and
    // mem.resolve (the prime, reading the full in-memory cache) answers every
    // query instantly meanwhile. The store's own reads wait on this gate, so a
    // half-seeded store never overwrites a primed answer with a short one. On
    // storeWork so a live frame's mirror lands after the seed, not inside it.
    let gate = queueStore(async () => {
      await clearIdb(db)
      await seedIdb(db, cache.peek())
    })
    store = idbResolver(db, undefined, (preds) => mem.resolve(preds), gate)
  } catch (e) {
    console.warn('durable query store unavailable —', e)
  }
}

let indexId = (eid: string, r?: Comps) => {
  if (!r) return
  if (r.entity) numEids.set(r.entity.num, eid)
  for (let s of slugsOf(r.alias)) aliasEids.set(s, eid)
  for (let n = 6; n <= Math.min(8, eid.length); n++) {
    let key = eid.slice(0, n).toLowerCase()
    if (!SHORT.test(key)) continue
    let hits = shortEids.get(key)
    if (hits) hits.add(eid)
    else shortEids.set(key, new Set([eid]))
  }
}

let unindexId = (eid: string, r?: Comps) => {
  if (!r) return
  if (r.entity && numEids.get(r.entity.num) == eid) {
    numEids.delete(r.entity.num)
  }
  for (let s of slugsOf(r.alias)) {
    if (aliasEids.get(s) == eid) aliasEids.delete(s)
  }
  for (let n = 6; n <= Math.min(8, eid.length); n++) {
    let key = eid.slice(0, n).toLowerCase()
    let hits = shortEids.get(key)
    if (!hits) continue
    hits.delete(eid)
    if (!hits.size) shortEids.delete(key)
  }
}

let indexIds = (graph: Record<string, Comps>) => {
  numEids.clear()
  aliasEids.clear()
  shortEids.clear()
  for (let [eid, r] of Object.entries(graph)) indexId(eid, r)
  idGraph = graph
}

// Tests and host integrations may replace the exported cache directly. The
// browser stays incremental; an outside replacement pays one rebuild.
let syncIds = () => {
  let graph = cache.peek()
  if (graph != idGraph) indexIds(graph)
}

// Renderers hold these narrow signals; the complete cache remains the
// persistence and query door. A signal is minted once per eid so a patch
// cannot wake an unrelated entity.
export let row = (eid: string) => {
  let current = untracked(() => cache.value[eid])
  let found = rowSignals.get(eid)
  if (!found) {
    rowSignals.set(eid, found = signal(current))
  } else if (found.peek() !== current) found.value = current
  return found
}

// Edges by endpoint come from the derived index (index.ts byParent/byChild),
// not a bespoke computed: the same `{eid}`-derived mechanism that indexes
// references indexes the `dependency` triples, maintained incrementally rather
// than rebuilt per edge patch. syncIx heals a wholesale deps replacement.
export let relations = (eid: string) => {
  syncIx()
  let current = ix.byParent.get(eid) ?? noRelations
  let found = relationSignals.get(eid)
  if (!found) {
    relationSignals.set(eid, found = signal(current))
  } else if (found.peek() !== current) found.value = current
  return found
}

let childRelations = (eid: string) => {
  syncIx()
  let current = ix.byChild.get(eid) ?? noRelations
  let found = childSignals.get(eid)
  if (!found) {
    childSignals.set(eid, found = signal(current))
  } else if (found.peek() !== current) found.value = current
  return found
}

let publish = (
  eids: Set<string>,
  parentEids: Set<string>,
  childEids: Set<string>,
) =>
  batch(() => {
    for (let eid of eids) {
      let found = rowSignals.get(eid)
      if (found) found.value = cache.value[eid]
    }
    for (let eid of parentEids) {
      let found = relationSignals.get(eid)
      if (found) {
        found.value = ix.byParent.get(eid) ?? noRelations
      }
    }
    for (let eid of childEids) {
      let found = childSignals.get(eid)
      if (found) found.value = ix.byChild.get(eid) ?? noRelations
    }
  })

let resetSignals = () =>
  batch(() => {
    syncIds()
    indexAll(ix, cache.peek(), deps.peek())
    ixGraph = cache.peek()
    ixDeps = deps.peek()
    let touched = new Set([...census.peek(), ...Object.keys(cache.value)])
    census.value = Object.keys(cache.value)
    canvasVersion.value++
    for (let [eid, found] of rowSignals) found.value = cache.value[eid]
    for (let [eid, found] of relationSignals) {
      found.value = ix.byParent.get(eid) ?? noRelations
    }
    for (let [eid, found] of childSignals) {
      found.value = ix.byChild.get(eid) ?? noRelations
    }
    resetQueries()
    refreshBoards(touched)
    refreshPins(touched)
    refreshComments(touched)
    refreshFolds(touched)
    refreshBacklinks(touched)
    refreshJobs(touched)
    refreshBoardLinks(touched)
    refreshFacets(touched)
  })

// A z-only pin patch binds straight to its one DOM attribute. The fallback
// seeds cards mounted after the patch without making this signal map a cache.
export let pinZ = (eid: string, fallback: number) => {
  let z = pinZs.get(eid)
  if (!z) pinZs.set(eid, z = signal(fallback))
  return z
}

let sameProps = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) => {
  let keys = Object.keys(a)
  return keys.length == Object.keys(b).length &&
    keys.every((k) => Object.is(a[k], b[k]))
}

// Where the server lives and what a code reload means. The browser answers
// both from its location; other hosts (the TUI) configure these before
// boot() — a terminal process can't "reload the page". swap/css are the
// hot doors: main.tsx installs them at boot, and a host that doesn't
// (the TUI) just falls back to reload — a no-op without a location.
let loc = (globalThis as {
  location?: { host: string; protocol?: string; reload(): void }
}).location
export let config: {
  host: string
  secure: boolean
  // This tab's client eid, ridden on the /ws URL so its writes journal a
  // resolved actor (T-6669). The browser sets it (clientId); the TUI
  // leaves it unset — localStorage is a browser thing — and its writes
  // resolve to the box owner.
  client?: string
  // One switch restores 2.1's per-tab socket + boot-only IDB writes.
  shared: boolean
  // Stage-2 migration probes compare shadow sets to scans. Deployed clients
  // maintain the shadow without carrying agreement telemetry.
  agreement: boolean
  // Make the durable IDB store the query surface (T-17126). OFF by default:
  // real-browser measurement (~58s whole-graph seed, 75–450ms cold resolve at
  // 15.5k entities) shows the async store can't yet be the LIVE surface while
  // the full in-memory cache remains the escape hatch — the fast in-memory
  // resolver stays the surface until the cache shrinks (T-17064) and a
  // persistent delta-synced store lands. The flip mechanism is wired and
  // parity-proven; a probe (?store=idb) turns it on to exercise and measure it.
  store: boolean
  reload: () => void
  swap?: (gen: number) => void
  css?: (gen: number) => void
} = {
  host: loc?.host ?? '127.0.0.1:5173',
  // Behind an https front door the page's scheme must carry through to
  // the socket and fetches — a hardcoded http:// is mixed content there.
  secure: loc?.protocol == 'https:',
  shared: true,
  agreement: false,
  store: false,
  reload: () => loc?.reload(),
}
export let agreementProbe = (search: string) =>
  new URLSearchParams(search).get('probe') == 'subscriptions'
export let storeProbe = (search: string) =>
  new URLSearchParams(search).get('store') == 'idb'
export let base = () => `http${config.secure ? 's' : ''}://${config.host}`

// The column sort: priority first (lower sorts higher), num as tiebreak.
export { settled, statuses, uuid } from './types.ts'
import { kindOf, uuid } from './types.ts'
export let byPriority = (a: Ent, b: Ent) =>
  (a.task!.priority - b.task!.priority) || (a.num - b.num)

// An Ent's warmth — the cache-side face of query.ts warm(), for boards
// that say .order=hot. The Ent flattens the spine, so re-nest what the
// scorer reads (project/task ride along so retirement can sink it);
// ties break to the newer num, like byPriority.
export let warmth = (e: Ent, now: number) =>
  warm(
    {
      recall: e.recall as Record<string, unknown> | undefined,
      updated: e.updated as Record<string, unknown> | undefined,
      created: e.created as Record<string, unknown> | undefined,
      project: e.project as Record<string, unknown> | undefined,
      task: e.task as unknown as Record<string, unknown> | undefined,
    },
    now,
    (eid) => cache.value[eid],
  )
export let byWarmth = (now: number) => (a: Ent, b: Ent) =>
  (warmth(b, now) - warmth(a, now)) || (b.num - a.num)

// Gated = the red alarm on the Dot: this task is BLOCKED on something
// external (D-17094), the `blocked` facet present. That is the only thing
// that burns red now. Open `requires`/`contains` edges are NORMAL work —
// decomposition and queuing — so they render as the calm deps tally (the
// Meta line's "requires N"), never the alarm. A block is a fact stamped by
// `task block`, orthogonal to status: a task is blocked AND open/wip.
export let gated = (e: Ent) => e.blocked != null

// The calm deps affordance: how many `requires`/`contains` children are
// still unsettled — the "N open deps" count that used to (wrongly) burn red.
// A non-task child can't settle, so it counts as open. Zero renders nothing.
export let openDeps = (e: Ent) => {
  let requires = e.refs.filter((r) => r.type == 'requires').map((r) =>
    ent(r.child)
  )
  return [...requires, ...e.kids].filter((c) => !settled(c.task?.status)).length
}

// Who this viewer IS, for the verbs that are per-actor. A browser has no
// session — its identity is the actor its client entity names — and a
// viewer that names none holds no standing instructions, so the verbs
// that need one simply aren't offered.
export let myActor = () => {
  let c = config.client ? cache.value[config.client] : undefined
  return String(c?.client?.actor ?? '') || undefined
}

// What this viewer has said about an entity: 'watch', 'mute', or nothing.
export let myMode = (target: string) => {
  let me = myActor()
  if (!me) return undefined
  let hit = rows().find((r) =>
    r.comps.subscription &&
    String(r.comps.subscription.actor) == me &&
    String(r.comps.subscription.target) == target
  )
  return hit?.comps.subscription?.mode as 'watch' | 'mute' | undefined
}

// How many inbox items are waiting for this entity — a derived display
// fact like gated() above, so it belongs here rather than in the view.
// The SAME predicate the Inbox view, `task inbox` and the boot digest
// read: a number on a tab can never promise what the tab doesn't hold.
export let unreadFor = (eid: string) => {
  let all = rows()
  return all.filter(inboxItem(readerAt(all, eid))).filter(isUnread).length
}

// A live hand on the entity: its claim's session is awake — a managed
// run still going, or an external door still open. The wip pip pulses
// on this instead of sitting half-filled; a stale claim doesn't count.
export let crewed = (e: Ent) => {
  let s = e.claim && ent(e.claim.session).session
  return !!s && awake(s)
}

// Which door boot took, plus a cache peek — exposed for eyes (a CDP probe,
// the console) to verify properties invisible from the DOM (the reload win,
// live-only columns that never touch IDB). Not load-bearing.
let mark = (path: string) => ((globalThis as { __boot?: string }).__boot = path)
;(globalThis as { __peek?: (eid: string) => unknown }).__peek = (eid) =>
  cache.value[eid]

// Land a batch in the cache with the same patch semantics the db uses:
// comps merge per-column, comp: null deletes the component, entity: null
// deletes the entity and every edge touching it. Returns the eids and edges
// it touched (an entity death touches the eid AND every edge it swept) so the
// persist tail — and boot's explicit delta write — mirror exactly those keys
// into IDB, no diff of the whole cache.
export let applyLocal = (changes: Change[]) => {
  syncIds()
  syncIx()
  let graph = cache.peek()
  let eids = new Set<string>()
  let edges: Dep[] = []
  let changedRows = new Set<string>()
  let changedParents = new Set<string>()
  let changedChildren = new Set<string>()
  let changedPins = new Set<string>()
  let changedCanvas = false
  let changedCensus = false
  let changed = false
  // Camera motion renders from camera.value + hear(), not the graph cache.
  // Keep its durable row current without publishing a whole-graph signal.
  let motion = ({ eid, name, comp }: Change) =>
    !!cache.value[eid]?.camera && comp != null &&
    (name == 'camera' || name == 'updated')
  // Stacking is its own live partition too: raising one card must repaint
  // pins, not every entity and board mounted around them.
  let stacking = ({ eid, name, comp }: Change) =>
    !!cache.value[eid]?.pin && comp != null &&
    (name == 'updated' ||
      (name == 'pin' && Object.keys(comp).every((p) => p == 'z')))
  let quiet = changes.length > 0 &&
    changes.every((c) => motion(c) || stacking(c))
  let next = quiet ? cache.value : { ...cache.value }
  let zs = new Map<string, number>()
  for (let { eid, name, comp } of changes) {
    if (name == 'entity' && comp == null) {
      let before = next[eid]
      let lived = !!before
      eids.add(eid)
      if (lived) {
        delete next[eid]
        pinZs.delete(eid)
        changed = true
        changedCensus = true
        changedRows.add(eid)
        changedPins.add(eid)
        if (before.canvas) changedCanvas = true
      }
      // The cascade: every edge touching the dead eid leaves deps too —
      // record them so the IDB shadow drops the same rows the signal does.
      for (let d of deps.value) {
        if (d.parent == eid || d.child == eid) {
          edges.push(d)
          reindexEdge(ix, d, true)
          changedParents.add(d.parent)
          changedChildren.add(d.child)
        }
      }
      if (edges.length) {
        deps.value = deps.value.filter((d) => d.parent != eid && d.child != eid)
      }
      continue
    }
    // An edge change names its whole triple (see db.ts): gone removes it,
    // otherwise it joins the edge list once.
    if (name == 'dependency') {
      if (!comp) continue
      let d = {
        parent: eid,
        type: comp.type as Dep['type'],
        child: String(comp.child),
      }
      edges.push(d)
      let same = (x: Dep) =>
        x.parent == d.parent && x.type == d.type && x.child == d.child
      let nextDeps = comp.gone
        ? deps.value.filter((x) => !same(x))
        : deps.value.some(same)
        ? deps.value
        : [...deps.value, d]
      if (nextDeps != deps.value) {
        deps.value = nextDeps
        reindexEdge(ix, d, !!comp.gone)
        changedParents.add(eid)
        changedChildren.add(d.child)
      }
      continue
    }
    eids.add(eid)
    let before = next[eid] as Record<string, unknown> | undefined
    if (comp == null) {
      if (!before || !(name in before)) continue
      let row = { ...before }
      delete row[name]
      next[eid] = row as Comps
      changed = true
      changedRows.add(eid)
      if (name == 'card' || name == 'pin') changedPins.add(eid)
      if (name == 'canvas' || (name == 'entity' && before?.canvas)) {
        changedCanvas = true
      }
      continue
    }
    let prior = before?.[name] as Record<string, unknown> | undefined
    let after = { ...prior, ...comp }
    if (prior && sameProps(prior, after)) continue
    next[eid] = { ...before, [name]: after } as Comps
    if (!before) changedCensus = true
    if (name == 'pin' && after.z != null) zs.set(eid, Number(after.z))
    if (
      name == 'card' ||
      (name == 'pin' && Object.keys(comp).some((p) => p != 'z'))
    ) changedPins.add(eid)
    if (name == 'canvas' || (name == 'entity' && before?.canvas)) {
      changedCanvas = true
    }
    changed = true
    changedRows.add(eid)
  }
  if (changed && !quiet) {
    for (let eid of changedRows) {
      unindexId(eid, graph[eid])
      indexId(eid, next[eid])
      reindex(ix, eid, graph[eid], next[eid])
    }
    cache.value = next
    idGraph = next
  }
  ixGraph = cache.peek()
  ixDeps = deps.peek()
  batch(() => {
    if (changedCensus) census.value = Object.keys(next)
    if (changedCanvas) canvasVersion.value++
    publish(changedRows, changedParents, changedChildren)
    refreshBoards(changedRows)
    refreshPins(changedPins)
    refreshComments(changedRows)
    refreshFolds(changedRows)
    refreshBacklinks(changedRows)
    refreshJobs(changedRows)
    refreshQueries(changedRows)
    refreshBoardLinks(changedRows)
    refreshFacets(changedRows)
    for (let [eid, z] of zs) {
      let live = pinZs.get(eid)
      if (live) live.value = z
    }
  })
  // The touched keys feed either the boot catch-up write, or the Web-Lock
  // leader's live persist. Followers and 2.1 fallback tabs never persist a
  // live frame.
  return { eids: [...eids], edges }
}

// The cursor/epoch/vocab this tab holds. A promoted follower opens its socket
// from this cursor; the server replays the handoff gap before joining it to
// live broadcast.
let held: idb.Meta = {}
export let capable = (name: string) => !!held.capabilities?.includes(name)

// Consumers that care about canonical live edits subscribe here. WebSocket is
// an implementation detail now that follower tabs have none.
let listeners = new Set<(changes: Change[]) => void>()
export let hear = (fn: (changes: Change[]) => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
let tell = (changes: Change[]) => {
  for (let fn of listeners) fn(changes)
}

// Bodies ride only on the payloads that paint one entity whole (subs.ts
// `bodied`), and a patch that names no body leaves none either — so a cached
// doc can lack its body while the stored column holds one. The column
// defaults to '', so an ABSENT body means UNLOADED, never empty: nothing may
// render it as content or arm an editor over it, because a commit would write
// a fragment over the stored body. want() is the other end: the answer lands
// as an ordinary doc patch through applyLocal, which merges onto the cached
// doc and keeps its title — exactly what a live body edit does.
//
// One trip per PAINT, not per element: a card and all its comments ask
// within the same render, so the queue drains on the next turn and they
// travel together.
let asked = new Set<string>()
let queue = new Set<string>()
let sweep = () => {
  let eids = [...queue]
  queue.clear()
  for (let eid of eids) asked.add(eid)
  fetch(`${base()}/body?eids=${encodeURIComponent(eids.join(','))}`)
    .then((r) => r.json())
    .then((b: { changes?: Change[] }) => applyLocal(b.changes ?? []))
    // A dead server is not an answer: forget the ask so the next paint retries.
    .catch(() => {
      for (let eid of eids) asked.delete(eid)
    })
}
export let want = (eid: string) => {
  if (asked.has(eid) || queue.has(eid)) return
  if (!queue.size) setTimeout(sweep)
  queue.add(eid)
}

// Whether a view is still waiting on this entity's body — and ASKING is what
// fetches it, so no placeholder outlives one round trip. Fused for the same
// reason step() folds its bookkeeping into the verb: a caller that could
// paint the placeholder without asking would paint it forever.
export let pending = (e: Ent) => {
  if (!e.doc || e.doc.body !== undefined) return false
  want(e.eid)
  return true
}

// Land a local edit: cache first (instant render), then the wire.
export let mutate = (...changes: Change[]) => {
  problem.value = ''
  let parsed = normalizeChanges(changes, { resolve: findEid })
  applyLocal(parsed)
  send(...parsed)
}

type Catchup = { catchup: Change[]; cursor: number }
type Reset = { reset?: boolean; snapshot: Snapshot; error?: string }
export type Sub = {
  sub: string
  changes: Change[]
  drop?: string[]
  replace?: boolean
  cursor?: number
  shadow?: boolean
}
type Observed = { observe: unknown }
type Hot = 'reload' | { hmr: number } | { css: number }

let owner: ReturnType<typeof topology<unknown>> | null = null
let ws: WebSocket | null = null
let polling = false
let serial = Promise.resolve()

// Observations never join cache or IDB. One bounded state per watched Session
// is enough to paint its unfinished generation; the partition replaces it at
// the first durable output or reconnect frame.
let observations = signal<Record<string, ObservationState>>({})
export let observation = (session: string) => observations.value[session]
export let clearObservations = (session?: string) => {
  if (session == null) return void (observations.value = {})
  if (!observations.peek()[session]) return
  let next = { ...observations.peek() }
  delete next[session]
  observations.value = next
}
export let landObservation = (raw: unknown) => {
  let value = safeObservation(raw)
  if (!value) return false
  let was = observations.peek()[value.session]
  let state = foldObservation(was, value)
  if (state == was) return true
  let next = { ...observations.peek() }
  if (state) next[value.session] = state
  else delete next[value.session]
  observations.value = next
  return true
}
let settleObservations = (changes: Change[]) => {
  let next = observations.peek()
  let changed = false
  for (let [session, state] of Object.entries(next)) {
    if (!observedBy(state, changes)) continue
    if (!changed) next = { ...next }
    delete next[session]
    changed = true
  }
  if (changed) observations.value = next
}

let hot = (data: unknown): data is Hot => {
  if (data == 'reload') return true
  if (!data || typeof data != 'object') return false
  return 'hmr' in data || 'css' in data
}

// One physical socket. Only the lock holder calls this in shared mode; the
// fallback calls it per tab. Incoming JSON is parsed once here, serialized
// through IDB, then fanned as structured-clone data.
let connect = () => {
  if (ws && ws.readyState <= WebSocket.OPEN) return ws
  let socket = new WebSocket(
    `ws${config.secure ? 's' : ''}://${config.host}/ws${
      config.client ? `?client=${config.client}` : ''
    }`,
  )
  ws = socket
  // The catch-up handshake: send the held cursor first, so every later live
  // frame the server broadcasts arrives AFTER the catch-up it just sent.
  socket.onopen = () =>
    socket.send(JSON.stringify({
      since: held.cursor ?? 0,
      epoch: held.epoch,
      vocab: held.vocabHash,
      live: 1,
    }))
  socket.onmessage = (m) => {
    let data = JSON.parse(String(m.data)) as unknown
    serial = serial.then(async () => {
      // Reload must leave the leader before its own page disappears.
      let share = owner
      let leader = share?.isLeader() ?? false
      if (leader && hot(data)) share?.fan(data)
      await land(data, leader ? 'leader' : 'solo')
      if (leader && !hot(data)) share?.fan(data)
    }).catch((e) => {
      problem.value = String(e)
    })
  }
  socket.onclose = () => {
    if (ws != socket) return
    ws = null
    clearObservations()
    owner?.fan({ observe: null })
    if (polling) return
    polling = true
    let poll = setInterval(async () => {
      try {
        await fetch(`${base()}/snapshot`, { method: 'HEAD' })
        clearInterval(poll)
        polling = false
        owner?.fan('reload')
        setTimeout(config.reload)
      } catch { /* still down */ }
    }, 500)
  }
  return socket
}

let wire = (frame: unknown) => {
  let s = connect()
  let msg = JSON.stringify(frame)
  if (s.readyState == WebSocket.OPEN) s.send(msg)
  else s.addEventListener('open', () => s.send(msg), { once: true })
}

let route = (frame: unknown) => owner ? owner.route(frame) : wire(frame)
export let send = (...changes: unknown[]) => route(changes)

// Query subscriptions (T-3683), the client half. The cache becomes a UNION of
// subscription result sets: `subMembers` refcounts which eids each sub holds,
// so an eid that leaves EVERY subscription is evicted — the one new cache
// mechanic (design §4). A legacy full-broadcast client never subscribes, so
// this map stays empty and nothing is ever evicted. A shadow sub tracks the set
// without eviction while the complete stream remains the cache owner.
let subMembers = new Map<string, Set<string>>()
let subVersion = signal(0)
let shadows = new Set<string>()

// A subscription frame: land its changes like any batch (adds + updates flow
// through the unchanged applyLocal), then track membership. A death rides in
// `changes` as an entity-null (gone for everyone — applyLocal already removed
// it); a `drop` eid left THIS query but still exists (gone for this query
// only). Either way it leaves the sub's set, and an eid now in no set is
// evicted from the cache. A control reply replaces the prior set wholesale;
// maintenance frames patch it.
export let landSub = (f: Sub) => {
  if (f.replace && f.sub.startsWith('entries:')) {
    clearObservations(f.sub.slice('entries:'.length))
  }
  let touched = applyLocal(f.changes)
  settleObservations(f.changes)
  // The server marks shadow-ness on every frame it sends, so believe the
  // frame: the local `shadows` set only knows what THIS client asked for,
  // and the two must not be able to disagree about who owns the cache.
  if (f.shadow) shadows.add(f.sub)
  let old = subMembers.get(f.sub) ?? new Set<string>()
  let mine = f.replace ? new Set<string>() : old
  subMembers.set(f.sub, mine)
  let leaving: string[] = f.replace ? [...old] : [...(f.drop ?? [])]
  for (let c of f.changes) {
    if (c.name == 'entity' && c.comp == null) {
      mine.delete(c.eid)
      leaving.push(c.eid)
    } else mine.add(c.eid)
  }
  for (let eid of f.drop ?? []) mine.delete(eid)
  if (f.replace) leaving = leaving.filter((eid) => !mine.has(eid))
  if (!f.shadow && !shadows.has(f.sub)) evict(leaving)
  subVersion.value++
  return {
    eids: [...new Set([...touched.eids, ...(f.drop ?? [])])],
    edges: touched.edges,
  }
}

// Drop from the cache any eid held by no remaining subscription — a death
// already removed itself via applyLocal (harmless to revisit), a drop is the
// live "you no longer see this" that only this layer expresses.
let evict = (eids: string[]) => {
  syncIds()
  syncIx()
  let graph = cache.peek()
  let held = (eid: string) => [...subMembers.values()].some((s) => s.has(eid))
  let next = { ...cache.value }
  let changed = false
  let changedCanvas = false
  let gone = new Set<string>()
  for (let eid of eids) {
    if (!held(eid) && next[eid]) {
      if (next[eid].canvas) changedCanvas = true
      delete next[eid]
      pinZs.delete(eid)
      asked.delete(eid) // it may come back bodyless; let it ask again
      changed = true
      gone.add(eid)
    }
  }
  if (changed) {
    for (let eid of gone) {
      unindexId(eid, graph[eid])
      reindex(ix, eid, graph[eid], undefined)
    }
    cache.value = next
    idGraph = next
    ixGraph = next
    batch(() => {
      census.value = Object.keys(next)
      if (changedCanvas) canvasVersion.value++
      publish(gone, new Set(), new Set())
      refreshBoards(gone)
      refreshPins(gone)
      refreshComments(gone)
      refreshFolds(gone)
      refreshBacklinks(gone)
      refreshJobs(gone)
      refreshQueries(gone)
      refreshBoardLinks(gone)
      refreshFacets(gone)
    })
  }
}

// A control frame is an OBJECT (design §1), distinct from the array batches
// send() ships — a subscribe/replace or an unsubscribe.
let control = (frame: object) => {
  route(frame)
}
export let subscribe = (sub: string, q: string) => control({ sub, q })
let shadow = (sub: string, q: string) => {
  shadows.add(sub)
  control({ sub, q, shadow: true })
}
// Closing a subscription hands its members back. Both orderings matter and
// they pull opposite ways: the departing set must be read BEFORE the
// subscription goes (deleting it first loses the list), and evict() must run
// AFTER, because it asks the REMAINING subscriptions whether anyone still
// holds each eid — an eid two boards share survives the first close and
// leaves on the second. A shadow sub never owned the cache (the complete
// stream did), so it takes nothing with it.
let forget = (sub: string) => {
  let leaving = shadows.has(sub) ? [] : [...(subMembers.get(sub) ?? [])]
  shadows.delete(sub)
  subMembers.delete(sub)
  agreement?.checked.delete(sub)
  if (sub.startsWith('entries:')) {
    clearObservations(sub.slice('entries:'.length))
  }
  if (leaving.length) evict(leaving)
  subVersion.value++
}
export let unsubscribe = (sub: string) => {
  forget(sub)
  control({ unsub: sub })
}

// The subscription result is separate from the cache: undefined means the
// initial frame has not landed; an empty Set is a ready, empty result.
export let subEids = (sub: string): Set<string> | undefined => {
  subVersion.value
  let found = subMembers.get(sub)
  return found && new Set(found)
}

type Agreement = {
  checked: Map<string, string>
  counts: { agreements: number; divergences: number; annotated: number }
}
let agreement: Agreement | undefined
export let subscriptionChecks = () =>
  agreement ? { ...agreement.counts } : undefined

// Compare after adjacent full/sub frames have both had a turn. The scan stays
// the caller's render source; this is only a diagnostic and probe counter.
export let assertAgree = (
  sub: string,
  q: string,
  scan: Iterable<string>,
  members: Iterable<string>,
) => {
  if (!config.agreement) return
  let state = agreement ??= {
    checked: new Map(),
    counts: { agreements: 0, divergences: 0, annotated: 0 },
  }
  let expected = [...new Set(scan)].sort()
  let received = [...new Set(members)].sort()
  let signature = JSON.stringify([q, expected, received])
  if (state.checked.get(sub) == signature) return
  state.checked.set(sub, signature)
  setTimeout(() => {
    if (
      boardUses.get(sub)?.q != q || state.checked.get(sub) != signature
    ) return
    state.counts.agreements++
    let d = diff(expected, received)
    if (!d.scanOnly.length && !d.subOnly.length) return
    state.counts.divergences++
    let unsupported = gaps(parseQuery(q))
    let note = {
      sub,
      query: q,
      scanOnly: d.scanOnly,
      subOnly: d.subOnly,
      unsupported,
    }
    if (unsupported.length) {
      state.counts.annotated++
      console.warn('subscription agreement deferred —', note)
    } else {
      console.assert(false, 'subscription divergence', note)
    }
  }, 20)
}

let boardUses = new Map<string, { n: number; q: string }>()
let entryUses = new Map<string, number>()
// A board whose query NAMES the lazy partition (`.entry.session=S-3`) can't be
// answered from the root cache — entries are omitted from the snapshot. So the
// board holds an entry subscription per scoped session (the same door a Session
// view opens), which streams those entries into the cache for boardHits to
// match. Keyed by board sub → session eid → its unsubscribe. A cross-session
// lazy board (no `.entry.session=`, e.g. `.generation.provider=codex`) has no
// single session to subscribe and stays unrenderable in the cache; the server
// query door answers it, board rendering waits on server-paged membership.
let boardEntrySubs = new Map<string, Map<string, () => void>>()

let ownBoard = (sub: string, q: string) =>
  owner ? owner.use(sub, q) : shadow(sub, q)
let dropBoard = (sub: string) => owner ? owner.drop(sub) : unsubscribe(sub)

// Several views in one tab share one ownership entry. Cross-tab references
// reduce in leader.ts before the one logical board name reaches the socket.
export let boardSub = (e: Ent) => {
  let sub = `board:${e.eid}`
  let q = String(e.board?.query ?? '')
  let use = boardUses.get(sub)
  if (use) use.n++
  else {
    boardUses.set(sub, { n: 1, q })
    ownBoard(sub, q)
    syncEntrySubs(sub, q)
  }
  return () => {
    let held = boardUses.get(sub)
    if (!held || --held.n > 0) return
    boardUses.delete(sub)
    dropBoard(sub)
    syncEntrySubs(sub, '')
  }
}

// Entry entities are intentionally absent from the root snapshot. A Session
// view asks for only its ordered partition; ownership is shared across views
// and tabs just like a board subscription.
export let entrySub = (session: string) => {
  let sub = `entries:${session}`
  let n = entryUses.get(sub) ?? 0
  entryUses.set(sub, n + 1)
  if (!n) ownBoard(sub, `.entry.session=${session}`)
  return () => {
    let held = (entryUses.get(sub) ?? 1) - 1
    if (held > 0) return void entryUses.set(sub, held)
    entryUses.delete(sub)
    dropBoard(sub)
  }
}

// Bring a lazy board's scoped-session entry subscriptions into line with its
// query `q` (`''` closes them all). Reuses the ref-counted entrySub, so a board
// and an open Session view of the same session share one subscription. Sessions
// are resolved to eids by resolveRefs, matching the Session view's own key.
let syncEntrySubs = (sub: string, q: string) => {
  let want = new Set<string>()
  if (q) {
    let preds = resolveRefs(parseQuery(q), findEid)
    if (namesLazy(preds)) { for (let s of scopedSessions(preds)) want.add(s) }
  }
  let held = boardEntrySubs.get(sub) ?? new Map<string, () => void>()
  for (let [s, off] of held) {
    if (!want.has(s)) {
      off()
      held.delete(s)
    }
  }
  for (let s of want) if (!held.has(s)) held.set(s, entrySub(s))
  if (held.size) boardEntrySubs.set(sub, held)
  else boardEntrySubs.delete(sub)
}

// Query edits replace the installed name without tearing down its ownership.
export let boardQuery = (e: Ent) => {
  let sub = `board:${e.eid}`
  let q = String(e.board?.query ?? '')
  let use = boardUses.get(sub)
  if (!use || use.q == q) return
  use.q = q
  ownBoard(sub, q)
  syncEntrySubs(sub, q)
}

// Fetch the whole graph, fill the signals, seed IDB — the first-visit path
// and the 409 fallback share it (a stale cursor just means "do what a new
// visitor does"). Replace the cache wholesale (clear then apply), stamp the
// held cursor, and seed IDB — seed() is a `full` forward-only commit that
// wins across a changed epoch and clears the stale rows in the same txn.
let seedFrom = (snap: Snapshot, write = true) => {
  clearObservations()
  pinZs.clear()
  cache.value = {}
  deps.value = snap.deps
  // A wholesale replacement: skip the per-change durable mirror below and let
  // resetSignals → resetQueries seed the store in one bulk pass instead.
  seeding = true
  applyLocal(snap.changes)
  resetSignals()
  seeding = false
  held = {
    cursor: snap.cursor,
    epoch: snap.epoch,
    vocabHash: snap.vocabHash,
    capabilities: snap.capabilities,
  }
  if (write) {
    return idb.seed(
      cache.value,
      deps.value,
      snap.cursor ?? 0,
      snap.epoch ?? '',
      snap.vocabHash ?? '',
      snap.capabilities ?? [],
    )
  }
  return Promise.resolve(false)
}

// First-visit / no-IDB fill: the whole graph over HTTP (the TUI and a fresh
// browser have nothing to hydrate, and a full snapshot can't reorder — it is
// a complete prefix). The socket's {since} handshake that follows just joins
// the broadcast and closes the fetch→open gap with a tiny catch-up.
let fromSnapshot = async (write = true) =>
  seedFrom(await (await fetch(`${base()}/snapshot`)).json(), write)

let persist = (
  touched: { eids: string[]; edges: Dep[] },
  cursor: number,
) =>
  idb.persist(touched.eids, touched.edges, cache.value, deps.value, {
    epoch: held.epoch ?? '',
    vocabHash: held.vocabHash ?? '',
    cursor,
    capabilities: held.capabilities ?? [],
  })

type Land = 'leader' | 'follower' | 'solo'

// Every incoming shape has one landing door. A leader durably lands a
// cursor-stamped live frame before fan-out; followers land only in memory.
// Catch-up/reset still persist in solo mode — the 2.1 boot write.
let land = async (data: unknown, mode: Land) => {
  if (hot(data)) {
    if (data == 'reload') setTimeout(config.reload)
    else if ('hmr' in data) {
      config.swap ? config.swap(data.hmr) : config.reload()
    } else config.css?.(data.css)
    return
  }
  if (data && typeof data == 'object' && 'observe' in data) {
    let value = (data as Observed).observe
    if (value == null) clearObservations()
    else landObservation(value)
    return
  }
  let changes = liveChanges(data)
  if (changes) {
    let touched = applyLocal(changes)
    settleObservations(changes)
    let cursor = Array.isArray(data)
      ? undefined
      : (data as Partial<Live>).cursor
    if (cursor !== undefined) {
      held = { ...held, cursor }
      if (mode == 'leader') await persist(touched, cursor)
    }
    tell(changes)
    return
  }
  if (!data || typeof data != 'object') return
  let frame = data as Partial<Live & Catchup & Reset & Sub>
  if (frame.error) problem.value = String(frame.error)
  if (frame.catchup !== undefined) {
    let touched = applyLocal(frame.catchup)
    if (frame.cursor !== undefined) {
      held = { ...held, cursor: frame.cursor }
      if (mode != 'follower') await persist(touched, frame.cursor)
    }
  } else if (frame.snapshot) {
    mark('reset')
    await seedFrom(frame.snapshot, mode != 'follower')
  } else if (typeof frame.sub == 'string') {
    let touched = landSub(frame as Sub)
    if (frame.cursor !== undefined) {
      held = { ...held, cursor: frame.cursor }
      if (mode == 'leader') await persist(touched, frame.cursor)
    }
  }
}

let local = async (write: boolean) => {
  let stored = await idb.hydrate()
  if (stored.meta.cursor === undefined) {
    mark('snapshot')
    await fromSnapshot(write)
  } else {
    mark('hydrate+delta')
    pinZs.clear()
    cache.value = stored.ents
    deps.value = stored.deps
    resetSignals()
    held = stored.meta
  }
}

let booted = false
let once = async (write: boolean) => {
  if (booted) return
  await local(write)
  booted = true
}

let canShare = () => {
  let nav = (globalThis as { navigator?: Navigator }).navigator
  return config.shared && !!config.client && !!nav?.locks &&
    typeof globalThis.BroadcastChannel != 'undefined'
}

// Open BroadcastChannel + queue for the lock before touching IDB. Thus a
// follower cannot miss a leader frame during hydration. The gate's fallback
// is exactly slice 2.1: boot locally and open this tab's socket.
export let boot = async () => {
  // Opt into the durable IDB query surface from the URL (?store=idb) — a probe
  // switch, OFF by default (see config.store).
  let search = (globalThis as { location?: { search?: string } }).location
    ?.search ?? ''
  config.store ||= storeProbe(search)
  if (!canShare()) {
    await once(true)
    await attachStore()
    connect()
    return
  }
  let nav = (globalThis as { navigator: Navigator }).navigator
  let bus = new BroadcastChannel('tasks-sync')
  let channel: import('./leader.ts').Channel<unknown> = {
    onmessage: null,
    postMessage: (message) => bus.postMessage(message),
  }
  bus.onmessage = ({ data }) => channel.onmessage?.({ data })
  owner = topology(
    {
      request: (name, hold) => nav.locks.request(name, hold),
    },
    channel,
    {
      lead: async () => {
        await once(true)
        await attachStore()
        connect()
      },
      follow: () => once(false),
      solo: async () => {
        await once(true)
        await attachStore()
        connect()
      },
      receive: (frame) => {
        serial = serial.then(() => land(frame, 'follower'))
      },
      send: wire,
      subscribe: (sub, q) => {
        shadows.add(sub)
        wire({ sub, q, shadow: true })
      },
      unsubscribe: (sub) => wire({ unsub: sub }),
      forget,
    },
  )
  addEventListener('pagehide', owner.leave)
  await owner.start()
}
;(globalThis as {
  __sync?: () => {
    shared: boolean
    leader: boolean
    socket: number | null
    cursor?: number
  }
}).__sync = () => ({
  shared: !!owner && !owner.isSolo(),
  leader: owner?.isLeader() ?? false,
  socket: ws?.readyState ?? null,
  cursor: held.cursor,
})
// Probe hooks (T-17126) — for eyes (a CDP probe, the console) to verify the
// durable flip took and measure the real-browser subscribe/resolve latency the
// fake-indexeddb shim can only approximate. `store()` tells whether the IDB
// resolver is the surface; `resolve` times a one-shot indexed resolve; `hold`/
// `held` prove a HELD subscription's signal updates on a patch (the live
// reactivity path useQuery rides). Each mirrors exactly what the hook does —
// parse, ref-resolve, then the active resolver. Not load-bearing.
let probeHeld = new Map<string, Signal<string[]>>()
let probe = globalThis as {
  __probe?: {
    store: () => boolean
    resolve: (
      line: string,
    ) => Promise<{ store: boolean; ms: number; n: number }>
    hold: (line: string) => number
    held: (line: string) => number
  }
}
probe.__probe = {
  store: () => !!store,
  resolve: async (line) => {
    let preds = resolveRefs(parseQuery(line), findEid)
    let t0 = performance.now()
    let ids = store ? await store.ready(preds) : mem.resolve(preds)
    return { store: !!store, ms: performance.now() - t0, n: ids.length }
  },
  hold: (line) => {
    let preds = resolveRefs(parseQuery(line), findEid)
    probeHeld.set(line, holdQuery(preds))
    return probeHeld.get(line)!.value.length
  },
  held: (line) => probeHeld.get(line)?.value.length ?? -1,
}

// The whole entity, assembled for a renderer: spine, components present,
// outgoing edge sentences, contained children (recursive — graphs stay
// small; a view reads as deep as it wants).
export let ent = (eid: string): Ent => {
  let { entity, ...comps } = row(eid).value ?? {}
  if (comps.pin) comps.pin = { ...comps.pin, z: pinZ(eid, comps.pin.z).value }
  let session = sessionOf(comps)
  let mine = relations(eid).value
  return {
    ...comps, // whatever components the entity carries, verbatim —
    // created/updated (provenance) ride here like any other component now
    ...(session ? { session } : {}),
    eid,
    num: entity?.num ?? 0,
    kind: kindOf(comps), // derived — the display convention, not data
    refs: mine
      .filter((d) => d.type != 'contains')
      .map((d) => ({ type: d.type, child: d.child }))
      .sort((a, b) =>
        Number(settled(row(a.child).value?.task?.status)) -
        Number(settled(row(b.child).value?.task?.status))
      ),
    kids: mine
      .filter((d) => d.type == 'contains')
      .map((d) => ent(d.child)),
  }
}

// Markdown belongs to the project its entity speaks for. Follow only the
// graph's explicit ownership/reference columns: task/memory/role → project,
// comment → target, session → requested task. A seen set makes malformed
// cycles inert.
export let repoUrl = (start: Ent): string | undefined => {
  let seen = new Set<string>()
  let e: Ent | undefined = start
  while (e && !seen.has(e.eid)) {
    seen.add(e.eid)
    if (e.repo?.url) return e.repo.url
    let next: string | null | undefined = e.task?.project ??
      e.comment?.target ??
      e.session?.requested_task ?? e.role?.scope ?? e.memory?.scope
    e = next ? ent(next) : undefined
  }
}

export let findEid = (id: string): string | undefined => {
  syncIds()
  let num = id.match(/^[A-Za-z]+-(\d+)$/)?.[1] ?? id.match(/^(\d+)$/)?.[1]
  if (num) return numEids.get(+num)
  if (cache.peek()[id]) return id // a full eid, verbatim
  // A SHORT-eid handle: the 6–8 hex prefix a num-less entity wears (T-3684).
  if (SHORT.test(id)) {
    let hits = shortEids.get(id.toLowerCase())
    if (hits?.size == 1) return hits.values().next().value
    if (hits?.size) return // ambiguous
  }
  return aliasEids.get(id)
}
// The same query over the WHOLE graph — the board's List face. No task
// gate: sessions, memories, docs, web, people — anything that matches.
// Chrome stays out (a camera's updated.at churns with every pan and
// would drown any hot feed; cards/folds/shelves/clients are presence,
// not content), comments surface through their targets (the lately
// digest's rule), and a board is not news to itself.
let CHROME = new Set(['card', 'camera', 'fold', 'shelf', 'client', 'comment'])
let chrome = (r: Comps) => [...CHROME].some((name) => r[name as keyof Comps])
export let boardPost = (
  e: Ent,
  tasks: boolean,
  eids: Iterable<string>,
): string[] =>
  [...eids].filter((eid) => {
    let r = cache.value[eid]
    // Facets are the truth: a shelf is also a canvas, so kindOf cannot name
    // the chrome component that keeps it out of the feed.
    return !!r && (tasks ? !!r.task : eid != e.eid && !chrome(r))
  })

type BoardSet = {
  eid: string
  tasks: boolean
  q: string
  preds: ReturnType<typeof parseQuery>
  complex: boolean
  graph: Record<string, Comps>
  ids: Signal<string[]>
  error?: unknown
}
let boardSets = new Map<string, BoardSet>()
let boardKey = (eid: string, tasks: boolean) =>
  `${eid}:${tasks ? 'tasks' : 'all'}`
let boardHits = (
  e: Ent,
  tasks: boolean,
  preds: ReturnType<typeof parseQuery>,
) =>
  boardPost(e, tasks, Object.keys(cache.value))
    .filter((eid) => listed(cache.value[eid], preds))
    .filter((eid) => matchQuery(cache.value[eid], preds, (t) => cache.value[t]))

let scanBoard = (set: BoardSet, e: Ent) => {
  let q = String(e.board?.query ?? '')
  let parsed = parseQuery(q)
  let preds = resolveRefs(parsed, findEid)
  let hits = boardHits(e, set.tasks, preds)
  set.q = q
  set.preds = preds
  // A path can make one row's membership depend on another. Hot ordering
  // cannot: membership is still row-local, and a touched member already
  // republishes the ids below so the view can re-sort its warmth.
  set.complex = preds.some((p) => !!p.at)
  set.graph = cache.value
  set.error = undefined
  agree(set, e, q, hits)
  return hits
}

// Board membership is a local derived index, not a server subscription.
// A graph patch tests only its touched rows; stable membership keeps a
// parent Board asleep while an unrelated entity changes.
let boardSet = (e: Ent, tasks: boolean) => {
  let key = boardKey(e.eid, tasks)
  let q = String(e.board?.query ?? '')
  let found = boardSets.get(key)
  if (!found) {
    found = {
      eid: e.eid,
      tasks,
      q: '\0',
      preds: [],
      complex: false,
      graph: cache.peek(),
      ids: signal<string[]>([]),
    }
    boardSets.set(key, found)
  }
  if (found.q != q || found.graph != cache.peek()) {
    try {
      found.ids.value = untracked(() => scanBoard(found!, e))
    } catch (error) {
      found.q = q
      found.graph = cache.peek()
      found.error = error
    }
  }
  if (found.error) throw found.error
  return found
}

refreshBoards = (eids: Set<string>) => {
  for (let set of boardSets.values()) {
    let board = ent(set.eid)
    let q = String(board.board?.query ?? '')
    if (set.q != q || set.complex) {
      try {
        set.ids.value = untracked(() => scanBoard(set, board))
      } catch (error) {
        set.q = q
        set.graph = cache.peek()
        set.error = error
      }
      continue
    }
    let ids = set.ids.peek()
    let next = ids
    for (let eid of eids) {
      let had = next.includes(eid)
      let row = cache.peek()[eid]
      let candidate = !!row &&
        (set.tasks ? !!row.task : eid != set.eid && !chrome(row)) &&
        listed(row, set.preds)
      let wants = candidate &&
        matchQuery(row, set.preds, (t) => cache.peek()[t])
      if (had != wants) {
        next = wants ? [...next, eid] : next.filter((x) => x != eid)
      } else if (had) next = [...next]
    }
    set.graph = cache.peek()
    if (next != ids) set.ids.value = next
    // The other half of the agreement check, and the half that actually runs.
    // scanBoard's call can only fire on a full rescan, and a simple board gets
    // exactly one of those — at mount, BEFORE its subscription's first frame
    // has landed, so `members` is undefined and nothing is compared. From then
    // on every batch takes the branch above, and `set.graph` is stamped here,
    // so no later render rescans either: the counter for a simple board was
    // structurally pinned at zero. Measured on the real graph — eighteen boards
    // rendered, two writes pushed through, `subscriptionChecks()` still null.
    //
    // A counter that cannot count reads as "no divergence found" forever, which
    // is worse than having none: it is the evidence 2b is waiting on.
    agree(set, board, q, next)
  }
}

// Compare the client's own membership against the subscription's, whichever
// path produced it. `mine` is already post-filtered; the sub set is raw, so it
// goes through the same boardPost before the two can be compared at all.
let agree = (set: BoardSet, board: Ent, q: string, mine: string[]) => {
  if (!config.agreement) return
  let members = subEids(`board:${set.eid}`)
  if (!members) return
  assertAgree(`board:${set.eid}`, q, mine, boardPost(board, set.tasks, members))
}

let boardScan = (e: Ent, tasks: boolean): Ent[] =>
  boardSet(e, tasks).ids.value.map(ent)

export let boardTasks = (e: Ent): Ent[] => boardScan(e, true)
export let boardAll = (e: Ent): Ent[] => boardScan(e, false)

// The ephemeral filter's evaluator: a bar's line parsed and ref-resolved
// ONCE, returned as a per-row test — Board and the Lists AND it into
// whatever they already show. Throws like a saved query does; the bar
// catches (mid-keystroke is no place to error) where a board would show.
export let sieve = (line: string): (eid: string) => boolean => {
  let preds = resolveRefs(parseQuery(line), findEid)
  if (!preds.length) return () => true
  return (eid) =>
    matchQuery(cache.peek()[eid] ?? {}, preds, (t) => cache.peek()[t])
}

// The cache as client Rows — the shape the headless half's helpers speak
// (find, the change builders, the command line's Ctx), so an id lookup or
// a claim batch is written once and serves the CLI, the web and the TUI.
export let rows = (): Row[] =>
  Object.entries(cache.value).filter(([, r]) => !r.quarantined).map((
    [eid, r],
  ) => ({
    eid,
    num: r.entity?.num ?? 0,
    kind: kindOf(r),
    comps: r as Record<string, Record<string, unknown>>,
  }))

let facetGraph = cache.peek()
let facetVersion = signal(0)
let domainList: string[] = []
let projectIds: string[] = []
let sessionIds: string[] = []
let shelfIds: string[] = []
let scanFacets = () => {
  domainList = [
    ...new Set(
      Object.values(cache.peek()).flatMap((r) => r.task?.domain || []),
    ),
  ].sort()
  projectIds = Object.entries(cache.peek())
    .filter(([, r]) => r.project)
    .sort(([, a], [, b]) =>
      (a.entity?.num ?? Infinity) - (b.entity?.num ?? Infinity)
    )
    .map(([eid]) => eid)
  sessionIds = Object.entries(cache.peek())
    .filter(([, r]) => r.session)
    .map(([eid]) => eid)
  shelfIds = Object.entries(cache.peek())
    .filter(([, r]) => r.shelf)
    .map(([eid]) => eid)
  facetGraph = cache.peek()
}
let facets = () => {
  facetVersion.value
  if (facetGraph != cache.peek()) scanFacets()
}

// Pickers watch the domain/project census, then each returned project row.
// An unrelated patch changes neither and leaves an open editor asleep.
export let domains = {
  get value() {
    facets()
    return domainList
  },
}
export let projects = (): Ent[] => {
  facets()
  return projectIds.map(ent)
}
export let sessionRows = (): [string, Session][] => {
  facets()
  return sessionIds.flatMap((eid) => {
    let s = sessionOf(row(eid).value ?? {})
    return s ? [[eid, s]] : []
  })
}
export let shelfFor = (client: string) => {
  facets()
  return shelfIds.find((eid) => cache.peek()[eid]?.shelf?.client == client)
}

refreshFacets = (eids: Set<string>) => {
  let changed = [...eids].some((eid) => {
    let before = facetGraph[eid]
    let after = cache.peek()[eid]
    return before?.task?.domain != after?.task?.domain ||
      !!before?.project != !!after?.project ||
      ((!!before?.project || !!after?.project) &&
        before?.entity?.num != after?.entity?.num) ||
      !!before?.session != !!after?.session ||
      before?.shelf?.client != after?.shelf?.client
  })
  facetGraph = cache.peek()
  if (!changed) return
  scanFacets()
  facetVersion.value++
}

type CommentSet = {
  graph: Record<string, Comps>
  ids: Set<string>
  talk: Set<string>
  list: Signal<string[]>
  count: Signal<number>
}
type CommentIds = { ids: Set<string>; talk: Set<string> }
let commentSets = new Map<string, CommentSet>()
// One pass seeds every cold face. Per-target sets below own later live
// invalidation, so mounting a board never turns into one graph scan per tile.
let commentIndex = computed(() => {
  let found = new Map<string, CommentIds>()
  for (let [eid, r] of Object.entries(cache.value)) {
    let target = r.comment?.target
    if (!target) continue
    let ids = found.get(target)
    if (!ids) found.set(target, ids = { ids: new Set(), talk: new Set() })
    ids.ids.add(eid)
    ids.talk.add(eid)
  }
  return found
})
let commentIds = (target: string) => {
  let found = commentIndex.value.get(target)
  return {
    ids: new Set(found?.ids),
    talk: new Set(found?.talk),
  }
}

let commentSet = (target: string) => {
  let found = commentSets.get(target)
  if (!found) {
    let { ids, talk } = untracked(() => commentIds(target))
    found = {
      graph: cache.peek(),
      ids,
      talk,
      list: signal([...ids]),
      count: signal(talk.size),
    }
    commentSets.set(target, found)
  } else if (found.graph != cache.peek()) {
    let { ids, talk } = untracked(() => commentIds(target))
    found.ids = ids
    found.talk = talk
    found.graph = cache.peek()
    found.list.value = [...ids]
    found.count.value = talk.size
  }
  return found
}

// A face subscribes to its own comment list and tally. Birth, death,
// retargeting, and event changes update only the targets they affect.
export let commentsOn = (target: string): Ent[] =>
  commentSet(target).list.value.map(ent).sort((a, b) => a.num - b.num)
export let commentCount = (target: string) => commentSet(target).count

refreshComments = (eids: Set<string>) => {
  for (let [target, set] of commentSets) {
    let listed = false
    let counted = false
    for (let eid of eids) {
      let had = set.ids.has(eid)
      let spoke = set.talk.has(eid)
      let c = cache.peek()[eid]?.comment
      let wants = c?.target == target
      let talks = wants
      if (had != wants) {
        wants ? set.ids.add(eid) : set.ids.delete(eid)
        listed = true
      }
      if (spoke != talks) {
        talks ? set.talk.add(eid) : set.talk.delete(eid)
        counted = true
      }
    }
    set.graph = cache.peek()
    if (listed) set.list.value = [...set.ids]
    if (counted) set.count.value = set.talk.size
  }
}

type Folded = { eid: string; statuses: string }
type FoldSet = {
  graph: Record<string, Comps>
  value: Signal<Folded | undefined>
}
let foldSets = new Map<string, FoldSet>()
let foldKey = (client: string, board: string) => `${client}:${board}`
let scanFold = (client: string, board: string): Folded | undefined => {
  let found = Object.entries(cache.value).find(([, r]) =>
    r.fold?.client == client && r.fold.board == board
  )
  return found && {
    eid: found[0],
    statuses: String(found[1].fold?.statuses ?? ''),
  }
}

export let foldFor = (client: string, board: string) => {
  let key = foldKey(client, board)
  let found = foldSets.get(key)
  if (!found) {
    found = {
      graph: cache.peek(),
      value: signal(untracked(() => scanFold(client, board))),
    }
    foldSets.set(key, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.value.value = untracked(() => scanFold(client, board))
  }
  return found.value.value
}

refreshFolds = (eids: Set<string>) => {
  for (let [key, set] of foldSets) {
    let [client, board] = key.split(':')
    let current = set.value.peek()
    let relevant = [...eids].some((eid) =>
      eid == current?.eid || !!cache.peek()[eid]?.fold
    )
    set.graph = cache.peek()
    if (relevant) set.value.value = scanFold(client, board)
  }
}

// The root canvas (first canvas-tagged entity) and its pinned cards.
// A canvas whose num hasn't arrived yet can't be "first" — sorting the
// unknown to the front would yank every tab sitting on `/` to it.
export let rootCanvas = () => {
  canvasVersion.value
  return Object.entries(cache.peek())
    .filter(([, r]) => r.canvas)
    .sort(([, a], [, b]) =>
      (a.entity?.num ?? Infinity) - (b.entity?.num ?? Infinity)
    )[0]
    ?.[0]
}

type PinSet = {
  graph: Record<string, Comps>
  ids: Signal<string[]>
}
let pinSets = new Map<string, PinSet>()
let scanPins = (canvas: string) =>
  Object.entries(cache.value)
    .filter(([, r]) => r.pin?.canvas == canvas && r.card)
    .map(([eid]) => eid)

let pinSet = (canvas: string) => {
  let found = pinSets.get(canvas)
  if (!found) {
    found = {
      graph: cache.peek(),
      ids: signal(untracked(() => scanPins(canvas))),
    }
    pinSets.set(canvas, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.ids.value = untracked(() => scanPins(canvas))
  }
  return found
}

refreshPins = (eids: Set<string>) => {
  for (let [canvas, set] of pinSets) {
    let ids = set.ids.peek()
    let next = ids
    for (let eid of eids) {
      let had = next.includes(eid)
      let r = cache.peek()[eid]
      let wants = !!r?.card && r.pin?.canvas == canvas
      if (had != wants) {
        next = wants ? [...next, eid] : next.filter((x) => x != eid)
      } else if (had) next = [...next]
    }
    set.graph = cache.peek()
    if (next != ids) set.ids.value = next
  }
}

export let pinned = (canvas: string): Pinned[] =>
  pinSet(canvas).ids.value
    .map((eid) => [eid, cache.peek()[eid]] as const)
    .filter((x): x is readonly [string, Comps] => !!x[1]?.pin && !!x[1].card)
    .map(([eid, r]) => ({
      ...r.pin!,
      // The cache key IS the identity: a pin cast from another client
      // carries no eid inside its comp, and a Pinned without one aims
      // every raise/drag write at eid undefined (T-7437).
      eid,
      target: r.card!.target,
      view: r.card!.view,
    }))
    .sort((a, b) => (a.z - b.z) || (a.eid < b.eid ? -1 : 1))

// Who points HERE, and via what: every eid-typed prop in the SCHEMA —
// the wire-writable vocabulary UNION the server-stamped columns (a
// session's requested_task is an edge even though no client may
// write it) — scanned over the cache. A new association shows up in
// backlinks with no second edit: this is how a task finds its sessions
// and Debug lists whatever holds a reference to the entity on screen.
let eidProps = [...new Set([...Object.keys(vocab), ...Object.keys(stamped)])]
  .flatMap((c) =>
    Object.entries({ ...vocab[c], ...stamped[c] })
      .filter(([, t]) => typeof t == 'object' && 'eid' in t)
      .map(([p]) => [c, p] as [string, string])
  )
type Backlink = { from: string; via: string }
type BacklinkSet = {
  graph: Record<string, Comps>
  value: Signal<Backlink[]>
}
let backlinkSets = new Map<string, BacklinkSet>()
let linksFrom = (from: string, r: Comps | undefined, target: string) =>
  !r ? [] : eidProps
    .filter(([c, p]) =>
      (r[c as keyof typeof r] as Record<string, unknown>)?.[p] == target
    )
    .map(([c, p]) => ({ from, via: `${c}.${p}` }))
let scanBacklinks = (target: string) =>
  Object.entries(cache.value).flatMap(([from, r]) => linksFrom(from, r, target))

export let backlinks = (target: string) => {
  let found = backlinkSets.get(target)
  if (!found) {
    found = {
      graph: cache.peek(),
      value: signal(untracked(() => scanBacklinks(target))),
    }
    backlinkSets.set(target, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.value.value = untracked(() => scanBacklinks(target))
  }
  return found.value.value
}

refreshBacklinks = (eids: Set<string>) => {
  for (let [target, set] of backlinkSets) {
    let changed = [...eids].some((eid) =>
      JSON.stringify(linksFrom(eid, set.graph[eid], target)) !=
        JSON.stringify(linksFrom(eid, cache.peek()[eid], target))
    )
    set.graph = cache.peek()
    if (changed) set.value.value = scanBacklinks(target)
  }
}

let scanJob = (session: string): string | null =>
  Object.entries(cache.value)
    .filter(([, r]) => r.task && r.claim?.session == session)
    .toSorted(([, a], [, b]) =>
      String(b.claim?.claimed_at ?? '').localeCompare(
        String(a.claim?.claimed_at ?? ''),
      )
    )[0]?.[0] ?? null

type JobSet = {
  graph: Record<string, Comps>
  value: Signal<string | null>
}
let jobSets = new Map<string, JobSet>()

// The task a session is ON: the newest task it holds a claim over, else
// its managed request. Each session watches only claim-bearing rows.
export let jobOf = (e: Ent): string | null => {
  let found = jobSets.get(e.eid)
  if (!found) {
    found = {
      graph: cache.peek(),
      value: signal(untracked(() => scanJob(e.eid))),
    }
    jobSets.set(e.eid, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.value.value = untracked(() => scanJob(e.eid))
  }
  return found.value.value ?? e.session?.requested_task ?? null
}

refreshJobs = (eids: Set<string>) => {
  for (let [session, set] of jobSets) {
    let changed = [...eids].some((eid) => {
      let before = set.graph[eid]
      let after = cache.peek()[eid]
      let mine = before?.claim?.session == session ||
        after?.claim?.session == session
      return mine &&
        (before?.claim !== after?.claim || !!before?.task != !!after?.task)
    })
    set.graph = cache.peek()
    if (changed) set.value.value = scanJob(session)
  }
}

// The edges that hold an entity FROM ABOVE — every dependency whose child
// is this eid. refs/kids read downward; this is the climb back up, how a
// task names the parents that contain or require it.
export let parents = (eid: string) => childRelations(eid).value

type BoardLinks = {
  graph: Record<string, Comps>
  value: Signal<string[]>
}
let boardLinks = new Map<string, BoardLinks>()
let scanBoardLinks = (target: string) =>
  Object.keys(cache.value).filter((eid) =>
    cache.value[eid].board?.query?.includes(target)
  )

// A board query carries refs as text, outside the schema's eid columns.
// The target face watches only board query rows that gain or lose its eid.
export let boardsOver = (target: string) => {
  let found = boardLinks.get(target)
  if (!found) {
    found = {
      graph: cache.peek(),
      value: signal(untracked(() => scanBoardLinks(target))),
    }
    boardLinks.set(target, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.value.value = untracked(() => scanBoardLinks(target))
  }
  return found.value.value
}

refreshBoardLinks = (eids: Set<string>) => {
  for (let [target, set] of boardLinks) {
    let changed = [...eids].some((eid) =>
      !!set.graph[eid]?.board?.query?.includes(target) !=
        !!cache.peek()[eid]?.board?.query?.includes(target)
    )
    set.graph = cache.peek()
    if (changed) set.value.value = scanBoardLinks(target)
  }
}

// The highest stacking order on a canvas — a raised card gets topZ + 1.
// The pin presence test is load-bearing: with `?.` alone a nullish canvas
// matches every PINLESS row too (undefined == null) and the map crashes.
export let topZ = (canvas: string) =>
  Math.max(
    0,
    ...Object.values(cache.value)
      .filter((r) => r.pin && r.pin.canvas == canvas)
      .map((r) => r.pin!.z),
  )

// Any interaction pulls a card to the front. Reads the pin fresh from the
// cache, so a burst of events (a scroll's worth of wheels) raises once.
// The card must clear every OTHER pin, not merely match the canvas top —
// a tie at the top (fresh pins all land at 0) still raises.
export let toFront = (pin: string) => {
  let p = cache.value[pin]?.pin
  if (!p) return
  let top = Math.max(
    -1,
    ...Object.entries(cache.value)
      .filter(([eid, r]) => eid != pin && r.pin?.canvas == p.canvas)
      .map(([, r]) => r.pin!.z),
  )
  if (p.z <= top) mutate({ eid: pin, name: 'pin', comp: { z: top + 1 } })
}

// Screen px → plane coords, through the camera over the given canvas rect.
export let toPlane = (clientX: number, clientY: number, rect: DOMRect) => {
  let { x, y, zoom, w, h } = camera.value
  return {
    x: (clientX - rect.left - (w / 2 - x * zoom)) / zoom,
    y: (clientY - rect.top - (h / 2 - y * zoom)) / zoom,
  }
}

// This client's camera over one canvas, if it exists yet.
export let myCamera = (client: string, canvas: string) =>
  Object.values(cache.value).find((r) =>
    r.camera?.client == client && r.camera?.canvas == canvas
  )?.camera

// Who this browser is: a client entity, its uuid minted into localStorage on
// first visit. The db rows appear when the camera first persists.
export let clientId = () => {
  let id = localStorage.getItem('tasks-client')
  if (!id) {
    id = uuid()
    localStorage.setItem('tasks-client', id)
  }
  return id
}

// This tab's camera over the canvas it's viewing: x/y is the viewport CENTER
// in plane coords, w/h the viewport size in screen px. Shared so drags can
// convert screen px into plane px.
export let camera = signal({ x: 0, y: 0, zoom: 1, w: 0, h: 0 })

// The vim mode this tab is in — per-tab UI state, never synced. Hotkeys
// (space, 0, …) only fire in normal mode; the statusbar owns transitions.
// visual is derived: a live selection outside a text input.
export let mode = signal<'normal' | 'insert' | 'command' | 'visual'>('normal')

// Whether the search palette is up. Shell state so a hot swap of the
// component graph can't shut it mid-search (Search.tsx owns the rest).
export let searchOpen = signal(false)

// Desktop opens entity links as floating cards at the pointer, oldest first.
// This is shell state: a component hot swap replaces nav.tsx, but the cards
// the operator is reading must stay open. view is its own optional tab choice.
export type Peeked = {
  eid: string
  x: number
  y: number
  view?: string
  from?: Element
}
export let peek = signal<Peeked[]>([])

// The roots passed through, oldest first — the App bar wears the last few
// as breadcrumbs. Shell state for the same reason as peek: where the
// operator has BEEN outlives any hot swap of the components that got them
// there. nav.tsx owns how it is written (track()).
export let trail = signal<string[]>([])
