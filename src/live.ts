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
  type Dep,
  type Ent,
  type EntCore,
  idOf,
  type Live,
  type Pinned,
  type Session,
  sessionOf,
  settled,
  SHORT,
  slugsOf,
  type Snapshot,
} from './types.ts'
import { isUnread, type Row, rowOf } from './client.ts'
import {
  distinctValues,
  EXISTS,
  type Field,
  matchQuery,
  namesLazy,
  parseQuery,
  type Pred,
  PROJECT,
  resolveRefs,
  scopedSessions,
  warm,
} from './query.ts'
import {
  anchor,
  children,
  emptyIndex,
  indexAll,
  refCols,
  reindex,
  reindexEdge,
} from './index.ts'
import { type MemoryResolver, memoryResolver } from './resolver.ts'
import type { References } from './referenced.ts'
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
// Derived from EntCore so a new component (types.ts) threads through here —
// and through ent() below — with zero edits. Exported so idb.ts persists
// and hydrates the exact shape the signal holds (T-6823). Omit over the CLOSED
// core keeps every known comp precise (an index signature on Ent would collapse
// keyof and lose them); the same open index signature is intersected back on so
// a plugin's comp reaches the cache as `unknown` (D-18663 seam 2, T-12765).
export type Comps =
  & { entity?: { eid: string; num: number } }
  & Omit<EntCore, 'eid' | 'num' | 'kind' | 'refs' | 'kids'>
  & { [comp: string]: Record<string, unknown> | undefined }

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
let refreshReferences = () => {}

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

// A reverse hop's Kids accessor over the live index: heal it, read the children
// (index.ts `children`), resolve each to a bag through `get` — `cache.value` to
// stay reactive inside a render, `cache.peek()` off it. One helper so every
// matcher call site answers `.comments…` the same way.
let kidsVia =
  (get: (eid: string) => Comps | undefined) =>
  (eid: string, comp: string, prop: string) => {
    syncIx()
    return children(ix, eid, comp, prop).map((k) => get(k))
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
  // A reverse hop's children, read off the same derived index the anchor uses —
  // the reverse map IS the EXISTS engine (index.ts). Healed first, then each
  // child eid resolved to its cache bag for the sub-filter.
  kids: (eid, comp, prop) => kidsVia((k) => cache.peek()[k])(eid, comp, prop),
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

// T-17126 — back queryEids on a genuine SERVER subscription. Today queryEids
// resolves "which entities match" against the LOCAL cache (mem/idbResolver, both
// cache.peek()); that is correct ONLY because join() at server.ts:596 seeds the
// cache whole. Under a working-set boot (T-18059) the cache goes partial and a
// local scan silently under-reports. So a MEMBERSHIP query opens a shadow sub —
// the very server sub boardSub installs, generalized to every useQuery site
// (`q:<canonical line>`): the server maintains the complete set forward-and-
// reverse (evalFast/matchQuery, scoped SQL) and streams it, and landSub keeps a
// per-sub signal this returns. `mem` primes the signal synchronously (no first-
// paint flash) and stays the fallback where there is no flag, no socket path
// (the TUI), or the query PROJECTS waking fields (pins/cameras — a projected-
// field move must re-fire the LIST, which only mem's wake tracking carries; a
// membership sub does not). Shadow means the whole stream still owns the cache,
// so nothing is evicted; the :596 flip turns these to owning and the cache
// becomes bounded. OFF until config.serverQuery (the ?ws-sub probe).
type ServerSet = {
  n: number
  ids: Signal<string[]>
  sub: string
  preds: Pred[]
}
let queryUses = new Map<string, ServerSet>() // canonical preds key -> set
let querySignals = new Map<string, Signal<string[]>>() // sub name -> its signal
let qkey = (preds: Pred[]) => JSON.stringify(preds)
let membersChanged = (a: Set<string>, b: Set<string>) =>
  a.size != b.size || [...b].some((e) => !a.has(e))

// Serialize exactly the pred shapes queryEids builds (has/eq/contains/refs) back
// to a query line, then PROVE the round-trip: only a line that re-parses to the
// same preds may open a sub, so an unhandled shape (a projection, a path deref,
// a reverse hop) FALLS BACK to mem rather than putting a wrong query on the wire.
// Values are already eids; findEid passes an eid through verbatim.
let predLine = (p: Pred): string | undefined => {
  if (p.refs) return p.op == '' ? `.refs=${p.value}` : undefined
  if (p.fields || p.at || p.rev || !p.comp) return undefined
  if (p.op == EXISTS && p.prop == '') return `.${p.comp}!`
  if (p.prop == '') return undefined
  if (p.op == '') return `.${p.comp}.${p.prop}=${p.value}`
  if (p.op == '~') return `.${p.comp}.${p.prop}~=${p.value}`
  return undefined
}
export let predsToQuery = (preds: Pred[]): string | undefined => {
  if (!preds.length) return undefined
  let parts = preds.map(predLine)
  if (parts.some((s) => s === undefined)) return undefined
  let line = parts.join('&')
  try {
    // Self-verify: the line must re-parse to the exact same preds, or it is not
    // trusted on the wire — the server would maintain a DIFFERENT set.
    if (qkey(resolveRefs(parseQuery(line), findEid)) == qkey(preds)) return line
  } catch { /* a shape the grammar can't round-trip — fall back to mem */ }
  return undefined
}

// The server line for a query when the flag is on and the shape round-trips;
// undefined routes the caller to the local resolver exactly as before.
let serverLine = (preds: Pred[]): string | undefined =>
  config.serverQuery ? predsToQuery(preds) : undefined

// Get-or-open the server set for a query. Opened ONCE on creation (a repeat
// ownBoard would re-subscribe every render); the signal is primed from mem so
// the first paint is populated, then landSub replaces it with the server's
// answer. Unheld direct readers (projects/commentsOn/…) keep it open, the same
// persistence mem's `sets` map gives an unheld query — bounded by the working set.
let serverSet = (preds: Pred[], line: string): ServerSet => {
  let key = qkey(preds)
  let found = queryUses.get(key)
  if (!found) {
    let sub = `q:${key}`
    found = { n: 0, ids: signal(mem.resolve(preds)), sub, preds }
    queryUses.set(key, found)
    querySignals.set(sub, found.ids)
    ownBoard(sub, line)
  }
  return found
}

// Read a query's result signal (get-or-create; the render half of the hook).
export let queryEids = (preds: Pred[]): Signal<string[]> => {
  let line = serverLine(preds)
  return line ? serverSet(preds, line).ids : (store ?? mem).subscribe(preds)
}
// Ref-count a query for a component's lifetime (the hook's effect half); the
// last release drops the set so distinct queries don't accumulate.
export let holdQuery = (preds: Pred[]): Signal<string[]> => {
  let line = serverLine(preds)
  if (!line) return (store ?? mem).hold(preds)
  let s = serverSet(preds, line)
  s.n++
  return s.ids
}
export let dropQuery = (preds: Pred[]) => {
  let line = serverLine(preds)
  if (!line) return void (store ?? mem).drop(preds)
  let s = queryUses.get(qkey(preds))
  if (!s || --s.n > 0) return
  queryUses.delete(qkey(preds))
  querySignals.delete(s.sub)
  dropBoard(s.sub)
}

// A query that is evaluated PER RENDERED ROW — a reverse-lookup keyed by the
// row's own eid (a tile's comment count on every entity in a list or tree) —
// must NEVER open a server sub, even with serverQuery on: that scales with rows
// on screen, not views, and a page of them floods the leader (1363 subs / a
// stalled serial chain, measured under ?ws-sub — T-21283). These resolve LOCALLY
// over the working set the DEFINING subs (boards/projects/sessions/canvases)
// stream in — a tile badge is best-effort, and an OPEN card's own view keeps its
// bounded sub for the complete, correct list. `mem` always, never the server.
let localEids = (preds: Pred[]): Signal<string[]> => mem.subscribe(preds)

// The reverse-reference reads phrased as the queries the vocabulary already
// answers: an eid EQUALITY anchors on the derived refs index (index.ts), a
// component PRESENCE on byComp, a CONTAINS over a text column's pool. Each helper
// builds the `Pred[]` the query layer caches per-shape, so a face reading one of
// the functions below (commentsOn, boardsOver, projects, …) wakes only when ITS
// result changes — never on an unrelated patch — with no bespoke per-relation set
// to maintain (T-17064, collapsing the reverse-index machinery into the one query
// door). Values are eids the caller already holds, so no ref-resolution pass is
// needed; equal shapes hit the same cached signal. This is the working-set seam
// too: when the boot serves a partial cache, queryEids resolves server-side and
// a reference outside the working set still counts (T-18094), where a cache scan
// would silently under-report.
let eq = (comp: string, prop: string, value: string): Pred => ({
  comp,
  prop,
  op: '',
  value,
})
let has = (comp: string): Pred => ({ comp, prop: '', op: EXISTS, value: '' })
let contains = (comp: string, prop: string, value: string): Pred => ({
  comp,
  prop,
  op: '~',
  value,
})
// The multi-column reverse-union (query.ts): every entity referencing `value`
// through SOME {eid} column — the backlinks of one eid, across the whole `refCols`
// vocabulary at once. `value` is already an eid the caller holds, so no
// ref-resolution pass is needed.
let refsTo = (value: string): Pred => ({
  comp: '',
  prop: '',
  op: '',
  value,
  refs: true,
})

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

// Re-derive every narrow signal, id index, derived index and query set from the
// cache as it stands now — the one wholesale-replacement pass a seed runs
// (seedFrom below), and the seam a test that assigns `cache.value` directly uses
// to bring the query resolver in step with the graph it just planted.
export let resetSignals = () =>
  batch(() => {
    syncIds()
    indexAll(ix, cache.peek(), deps.peek())
    ixGraph = cache.peek()
    ixDeps = deps.peek()
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
    clearResolved() // a reseed may now hold what the server-resolve sidecar named
    // A wholesale reseed (reconnect) is any-inbox-may-have-changed: refetch
    // every mounted one rather than diffing what the new graph implies.
    refreshInbox()
    refreshReferences()
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
  // Back queryEids on a genuine SERVER subscription instead of the local cache
  // (T-17126) — the gate the working-set boot (T-18059) needs so a partial cache
  // never under-reports. OFF by default: a membership queryEids opens a shadow
  // sub (the whole stream still owns the cache, nothing is evicted) and reads the
  // server-authoritative set; the flip to owning subs + a working-set boot is the
  // next leaf. A probe (?ws-sub) turns it on to exercise and measure.
  serverQuery: boolean
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
  serverQuery: false,
  reload: () => loc?.reload(),
}
export let agreementProbe = (search: string) =>
  new URLSearchParams(search).get('probe') == 'subscriptions'
export let storeProbe = (search: string) =>
  new URLSearchParams(search).get('store') == 'idb'
export let serverQueryProbe = (search: string) =>
  new URLSearchParams(search).has('ws-sub')
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
// One subscription per (actor, target), so this is a reverse-ref lookup on
// target (index.ts `children`), not a whole-cache scan. rows() screened out
// quarantined rows — keep that screen so the answer is unchanged.
export let myMode = (target: string) => {
  let me = myActor()
  if (!me) return undefined
  syncIx()
  let g = cache.value
  let hit = children(ix, target, 'subscription', 'target').find((eid) =>
    !g[eid]?.quarantined && String(g[eid]?.subscription?.actor) == me
  )
  return hit
    ? (g[hit]?.subscription?.mode as 'watch' | 'mute' | undefined)
    : undefined
}

// The inbox as the SERVER enumerates it (T-18105). The whole-graph cache is
// no longer scanned for inbox membership: GET /inbox?actor=<eid> returns the
// FINISHED rows for the browsing reader (the client.ts readerAt path, already
// screened by inboxItem), so the badge and the Inbox view read a partial cache
// exactly as they read a full one. A per-actor signal holds those rows; the
// first read kicks the fetch, and refreshInbox refetches on a relevant patch.
let inboxSignals = new Map<string, Signal<Row[]>>()
// One fetch per eid in flight; a patch arriving mid-fetch sets `again` so the
// door is asked once more when it settles — a burst collapses to one trailing
// refetch rather than stacking a request per frame.
let inboxLoading = new Set<string>()
let inboxAgain = new Set<string>()
let loadInbox = (eid: string) => {
  if (inboxLoading.has(eid)) return void inboxAgain.add(eid)
  inboxLoading.add(eid)
  fetch(`${base()}/inbox?actor=${encodeURIComponent(eid)}`)
    .then((r) => r.ok ? r.json() as Promise<Record<string, unknown>[]> : [])
    .then((rs) => {
      let sig = inboxSignals.get(eid)
      if (sig) sig.value = rs.map(rowOf)
    })
    // A dead server is not an emptier inbox — keep the last answer and let the
    // next relevant patch (or a reconnect reseed) retry.
    .catch(() => {})
    .finally(() => {
      inboxLoading.delete(eid)
      if (inboxAgain.delete(eid)) loadInbox(eid)
    })
}

// The finished inbox rows for an entity, live. Minted once per eid so a patch
// cannot wake an unrelated reader; refreshInbox refetches when the batch below
// touches something the inbox predicate reads. Empty until the first fetch
// lands — a badge that briefly shows nothing, never a stale count.
export let inbox = (eid: string): Row[] => {
  let sig = inboxSignals.get(eid)
  if (!sig) {
    inboxSignals.set(eid, sig = signal<Row[]>([]))
    loadInbox(eid)
  }
  return sig.value
}

// Tests and host integrations plant an entity's inbox rows directly — the same
// seam cache.value is (the /inbox door is the browser's only other filler),
// letting a render assert over a known inbox without a server round-trip.
export let setInbox = (eid: string, rows: Row[]) => {
  let sig = inboxSignals.get(eid)
  if (sig) sig.value = rows
  else inboxSignals.set(eid, signal<Row[]>(rows))
}

// How many unread items are waiting for this entity — a derived display fact
// like gated() above, so it belongs here rather than in the view. Reads the
// SAME server door the Inbox view does, so a number on a tab can never promise
// what the tab doesn't hold.
export let unreadFor = (eid: string) => inbox(eid).filter(isUnread).length

// Components an inbox item is made of, or whose edit changes membership or
// read-state for the browsing reader (client.ts inboxItem/readerAt): the four
// doors (comment/notice/knock with its `deliver` envelope/mail), the read+hide
// stamps (opened/archived), and the standing instruction (subscription). A
// batch naming none of these can't change any inbox, so every live one sleeps.
let inboxComps = new Set(
  [
    'comment',
    'notice',
    'knock',
    'deliver',
    'mail',
    'opened',
    'archived',
    'subscription',
  ],
)
let inboxDoors = ['comment', 'notice', 'knock', 'mail']
// Did this batch touch any live inbox? A cheap scan of the batch (never the
// cache), so the O(1)-per-frame budget holds under a live patch stream. An
// entity death counts only if the dead row WAS an inbox item — otherwise a
// deleted item would linger in the badge.
let inboxDirty = (changes: Change[], graph: Record<string, Comps>) =>
  changes.some((c) =>
    inboxComps.has(c.name) ||
    (c.name == 'entity' && c.comp == null && !!graph[c.eid] &&
      inboxDoors.some((n) => n in graph[c.eid]!))
  )
// Refetch every mounted inbox — used on a relevant live patch and on a
// wholesale reseed (reconnect), where any inbox may have changed at once.
let refreshInbox = () => {
  for (let eid of inboxSignals.keys()) loadInbox(eid)
}

let referenceSignals = new Map<string, Signal<References>>()
let referenceLoading = new Set<string>()
let referenceAgain = new Set<string>()
let loadReferences = (eid: string) => {
  if (referenceLoading.has(eid)) return void referenceAgain.add(eid)
  referenceLoading.add(eid)
  fetch(`${base()}/references?eid=${encodeURIComponent(eid)}`)
    .then((r) => r.ok ? r.json() as Promise<References> : { out: [], in: [] })
    .then((value) => {
      let found = referenceSignals.get(eid)
      if (found) found.value = value
    })
    .catch(() => {})
    .finally(() => {
      referenceLoading.delete(eid)
      if (referenceAgain.delete(eid)) loadReferences(eid)
    })
}

export let references = (eid: string): References => {
  let found = referenceSignals.get(eid)
  if (!found) {
    referenceSignals.set(eid, found = signal({ out: [], in: [] }))
    loadReferences(eid)
  }
  return found.value
}

refreshReferences = () => {
  for (let eid of referenceSignals.keys()) loadReferences(eid)
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
    if (name == 'canvas' || (name == 'entity' && before?.canvas)) {
      changedCanvas = true
    }
    changed = true
    changedRows.add(eid)
  }
  if (changed && !quiet) {
    cache.value = next
    // During a wholesale (re)seed the resetSignals() that follows in seedFrom
    // rebuilds the id-index and derived index in ONE pass (syncIds + indexAll)
    // and refreshes every partition — so the per-row maintenance and the batch
    // below are pure redundancy at seed, the dominant boot CPU (D-18055). Fill
    // the cache only; leaving idGraph/ixGraph stale makes resetSignals' single
    // build the one pass. Steady-state patches (!seeding) stay incremental.
    if (!seeding) {
      for (let eid of changedRows) {
        unindexId(eid, graph[eid])
        indexId(eid, next[eid])
        reindex(ix, eid, graph[eid], next[eid])
      }
      idGraph = next
    }
  }
  if (seeding) return { eids: [...eids], edges }
  ixGraph = cache.peek()
  ixDeps = deps.peek()
  batch(() => {
    if (changedCensus) census.value = Object.keys(next)
    if (changedCanvas) canvasVersion.value++
    publish(changedRows, changedParents, changedChildren)
    refreshQueries(changedRows)
    for (let [eid, z] of zs) {
      let live = pinZs.get(eid)
      if (live) live.value = z
    }
  })
  // A live inbox is a server query, not a cache scan, so it can't ride the
  // signal republish above — refetch it only when the batch names something
  // its predicate reads. `graph` is the pre-batch cache, so a deleted item's
  // row is still there for inboxDirty to recognise.
  if (inboxSignals.size && inboxDirty(changes, graph)) refreshInbox()
  if (referenceSignals.size && changes.some((c) => c.name == 'dependency')) {
    refreshReferences()
  }
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

// The outbox: every local edit is HELD here until the server acknowledges it
// by delivery id (T-21413 — fire-and-forget lost owner edits across a restart:
// applyLocal showed success while the frame died on a closing socket, and
// nothing ever retried or complained). An entry leaves only on `{ack}` (or a
// rejection frame, which surfaces and heals) — never on a send ATTEMPT.
let outbox = new Map<string, { changes: Change[]; at: number }>()
export let unsent = () => [...outbox.keys()]

// A reactive mirror of the outbox for the standing sync indicator (T-21441).
// The Map above stays plain — the hot redelivery loop must not walk a signal —
// so this signal is rebuilt from it on every outbox mutation, and a view
// re-renders only when what is pending actually changes. `since` is the moment a
// write was FIRST queued, held apart from the entry's `at` (which redelivery
// bumps on each retry), so "how long has this waited" stays honest; a write
// replayed from a prior life carries its parked `at` forward as that origin.
export let outboxWrites = signal<
  { id: string; since: number; count: number }[]
>([])
let firstSeen = new Map<string, number>()
let syncOutbox = () => {
  for (let [id, o] of outbox) if (!firstSeen.has(id)) firstSeen.set(id, o.at)
  for (let id of [...firstSeen.keys()]) {
    if (!outbox.has(id)) firstSeen.delete(id)
  }
  outboxWrites.value = [...outbox].map(([id, o]) => ({
    id,
    since: firstSeen.get(id) ?? o.at,
    count: o.changes.length,
  }))
}

// The refusal ledger (T-21441, M-16612): a write the server REJECTED (a moved
// precondition, a lease it can't hold) is durable and returnable. The user saw
// it land in the optimistic cache, and the drain path is about to reload the
// page and wipe the in-memory `problem`; a refusal must not vanish with it. Each
// is kept under the write's own delivery id — its stable identity — so it
// survives the reload, surfaces again at boot, and clears only when the user
// dismisses it. It names what failed (the batch), why (the server's reason), and
// that success would have been the write reaching the server. localStorage backs
// it by default; the TUI and the fast tier swap an in-memory double.
export type Refusal = {
  id: string
  reason: string
  at: number
  summary: string
}
type RefusalStore = {
  record: (r: Refusal) => void
  clear: (id: string) => void
  all: () => Refusal[]
}
let LEDGER = 'tasks-refused'
let readLedger = (): Refusal[] => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(LEDGER) ?? '[]')
  } catch {
    return []
  }
}
let writeLedger = (rs: Refusal[]) => {
  try {
    globalThis.localStorage?.setItem(LEDGER, JSON.stringify(rs))
  } catch { /* no storage — the in-memory signal still shows this session's */ }
}
let refusalStore: RefusalStore = {
  record: (r) =>
    writeLedger([...readLedger().filter((x) => x.id != r.id), r].slice(-50)),
  clear: (id) => writeLedger(readLedger().filter((x) => x.id != id)),
  all: () => readLedger(),
}
export let useRefusalStore = (s: RefusalStore): RefusalStore => {
  let prev = refusalStore
  refusalStore = s
  return prev
}
export let refused = signal<Refusal[]>([])
let syncRefused = () => (refused.value = refusalStore.all())

// One line naming a refused batch: how many changes, which components, which
// entities — enough for the user to know which edit the server threw away.
let summarize = (changes: Change[]): string => {
  if (!changes.length) return ''
  let names = [...new Set(changes.map((c) => c.name))].join(', ')
  let ids = [...new Set(changes.map((c) => idOf(ent(c.eid))))].join(', ')
  let n = `${changes.length} change${changes.length > 1 ? 's' : ''}`
  return `${n}${names ? ` (${names})` : ''}${ids ? ` to ${ids}` : ''}`
}

// Record a refusal durably and surface it now. Both refusal arms funnel here —
// the socket rejection frame and the pre-reload /apply drain — so every refused
// write persists the same way, under the delivery id the transport already keys.
export let refuse = (id: string, reason: string, changes: Change[] = []) => {
  refusalStore.record({
    id,
    reason,
    at: Date.now(),
    summary: summarize(changes),
  })
  syncRefused()
  problem.value = reason
}
export let clearRefusal = (id: string) => {
  refusalStore.clear(id)
  syncRefused()
}
// Surface at boot what a prior life left refused — the post-reload half of the
// durability guarantee: a drain refusal wiped by the reload it triggered is read
// straight back into view.
export let loadRefusals = () => syncRefused()

// The durable outbox's disk door (T-21440). The map above is lost on a tab
// crash or a manual reload, so — before either can discard an unacked write —
// every entry is mirrored to IndexedDB (idb.ts) under the SAME delivery id it
// carries in memory, and replayed at boot. This seam is the mirror: park on
// deliver, unpark on ack, read what a prior life left at boot. Defaults to the
// IDB store; the TUI and the fast tier — neither has IndexedDB — swap an
// in-memory double via useOutboxStore. Every op is best-effort, so a failure
// degrades to the in-memory-only outbox, never a broken frame.
type Parked = { changes: Change[]; at: number }
type OutboxStore = {
  park: (id: string, o: Parked) => void
  unpark: (id: string) => void
  parked: () => Promise<[string, Parked][]>
}
let outboxStore: OutboxStore = {
  park: (id, o) => void idb.parkWrite(id, o),
  unpark: (id) => void idb.unparkWrite(id),
  parked: () => idb.parkedWrites(),
}
export let useOutboxStore = (s: OutboxStore): OutboxStore => {
  let prev = outboxStore
  outboxStore = s
  return prev
}

// Redelivery: an unacked write is re-routed until the server confirms it.
// Re-applying the same patch is harmless (apply() is a merge of the same
// values); the id is stable across retries so the transport dedups, and the
// timer disarms itself when the outbox drains — no idle tick.
//
// The gap between retries BACKS OFF exponentially (T-21442). A fixed RESEND
// cadence turned a slow or wedged server into a runaway: every unacked write
// re-routed every 3s, and each re-apply wrote journal rows that wedged the
// server further — a positive feedback loop that ballooned the journal to
// ~1GB and took the graph down. So a write's gap DOUBLES on each retry
// (RESEND, 2·RESEND, … capped at RESEND_MAX), probing a stuck server on a
// widening interval instead of hammering it; a recovered server resets the
// cadence (resetBackoff on reconnect) so retries turn prompt again.
export let RESEND = 3_000
export let RESEND_MAX = 60_000
export let backoff = (wait: number) => Math.min(wait * 2, RESEND_MAX)
// Per-write current gap, keyed by delivery id. Absent = the first retry waits
// RESEND. Transient retry state, NOT parked — a reload starts a fresh cadence.
let waits = new Map<string, number>()
let redeliver: ReturnType<typeof setInterval> | undefined
export let redeliverNow = (force = false, now = Date.now()) => {
  if (!outbox.size) {
    if (redeliver !== undefined) clearInterval(redeliver)
    redeliver = undefined
    waits.clear()
    return
  }
  for (let [id, o] of outbox) {
    let wait = waits.get(id) ?? RESEND
    if (!force && now - o.at < wait) continue
    o.at = now
    waits.set(id, backoff(wait))
    route({ apply: o.changes, id }, id)
  }
}
// A reconnect means the server is reachable again: drop every write's backoff
// so the next tick re-sends unacked writes promptly instead of at a stale 60s.
export let resetBackoff = () => waits.clear()
let armRedeliver = () => {
  if (redeliver !== undefined) return
  redeliver = setInterval(redeliverNow, RESEND) // Headless (TUI, tests): an armed retry must never hold the process open.
  ;(globalThis as { Deno?: { unrefTimer?: (id: number) => void } })
    .Deno?.unrefTimer?.(redeliver as unknown as number)
}
let deliver = (changes: Change[]) => {
  let id = crypto.randomUUID()
  let o = { changes, at: Date.now() }
  outbox.set(id, o)
  outboxStore.park(id, o) // durable: outlive a crash/reload before the ack
  syncOutbox() // the standing indicator now shows this write as unsent
  armRedeliver()
  route({ apply: changes, id }, id)
}
export let acked = (id: string) => {
  outbox.delete(id)
  waits.delete(id) // the backoff leaves with its write
  outboxStore.unpark(id) // the durable copy leaves with the in-memory one
  syncOutbox()
  if (!outbox.size) redeliverNow()
}

// Replay a crashed or reloaded tab's undelivered writes (T-21440). A prior
// life may have parked writes it never saw acked; load them back under their
// ORIGINAL delivery ids and route them once. The id is stable, so redelivery
// dedups (leader.ts route) and a re-apply is the same harmless value-merge —
// so replaying from more than one hydrating tab is safe: whichever boots first
// owns them, the rest re-add nothing (the outbox.has guard) and their sends
// collapse on that id. A write whose entity was since tombstoned is refused by
// apply() and settles the id like any rejection (land()'s error arm), never
// crashing boot. Runs inside once(), BEFORE the socket opens, so no ack can
// outrun the entry it clears.
export let replayOutbox = async () => {
  let woke = false
  for (let [id, o] of await outboxStore.parked()) {
    if (outbox.has(id)) continue
    outbox.set(id, o)
    woke = true
  }
  if (woke) {
    syncOutbox()
    armRedeliver()
    redeliverNow(true)
  }
}

// A reload discards this tab's memory — outbox included — so undelivered
// writes must land through the durable door first. POST /apply carries the
// same client attribution the socket handshake does; a duplicate of an
// already-applied batch is the same harmless re-merge redelivery makes. A
// REFUSED batch is dropped and surfaced (retrying a refusal changes nothing);
// an unreachable server keeps the outbox and reports failure so the caller
// holds the reload — losing a write silently is the one unacceptable outcome.
let drain = async (): Promise<boolean> => {
  for (let [id, o] of [...outbox]) {
    try {
      let res = await fetch(`${base()}/apply`, {
        method: 'POST',
        headers: config.client ? { 'x-via': config.client } : {},
        body: JSON.stringify(o.changes),
      })
      if (!res.ok) refuse(id, await res.text(), o.changes) // durable: the reload
      outbox.delete(id) //                     this drain precedes would wipe it
      waits.delete(id)
    } catch {
      return false
    }
  }
  syncOutbox()
  return true
}

// Land a local edit: cache first (instant render), then the acked wire.
export let mutate = (...changes: Change[]) => {
  problem.value = ''
  let parsed = normalizeChanges(changes, { resolve: findEid })
  if (!parsed.length) return
  applyLocal(parsed)
  deliver(parsed)
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

// Socket liveness (T-21511). A half-open socket (network drop with no FIN, a
// suspended/backgrounded tab) stays `readyState == OPEN`, so onclose never fires
// and the reconnect poller never starts — the tab goes silently deaf until a
// manual reload. The server pings every 25s (server.ts PING_MS); the watchdog
// resets on ANY frame and, after WATCHDOG_MS of total silence, force-closes the
// socket so the existing onclose → poller → reconnect path runs. `seen` is the
// last-frame time, so a tab refocused after being frozen can tell a live socket
// from a stale one.
let WATCHDOG_MS = 60_000
let seen = 0
let watchdog: ReturnType<typeof setTimeout> | undefined
// A heartbeat frame carries liveness only, never graph data.
export let isPing = (data: unknown): boolean =>
  !!data && typeof data == 'object' && 'ping' in data
// A socket is stale if it is not OPEN, or has heard nothing (data OR ping) for
// `ms` — the refocus/watchdog recovery trigger.
export let socketStale = (
  readyState: number,
  since: number,
  now: number,
  ms = WATCHDOG_MS,
): boolean => readyState != WebSocket.OPEN || now - since > ms
let pet = () => {
  seen = Date.now()
  if (watchdog !== undefined) clearTimeout(watchdog)
  watchdog = setTimeout(() => {
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close()
  }, WATCHDOG_MS)
}
let unpet = () => {
  if (watchdog !== undefined) clearTimeout(watchdog)
  watchdog = undefined
}

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
  socket.onopen = () => {
    pet()
    resetBackoff() // server reachable again → retry unacked writes promptly
    socket.send(JSON.stringify({
      since: held.cursor ?? 0,
      epoch: held.epoch,
      vocab: held.vocabHash,
      live: 1,
      // ws:1 asks a cold boot to seed the WORKING SET, not the whole graph
      // (M-21143) — safe only because serverQuery keeps membership complete.
      ws: config.serverQuery ? 1 : undefined,
    }))
  }
  socket.onmessage = (m) => {
    pet()
    let data = JSON.parse(String(m.data)) as unknown
    // A heartbeat frame is liveness only (T-21511) — pet the watchdog, land
    // nothing.
    if (isPing(data)) return
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
    unpet()
    if (ws != socket) return
    ws = null
    clearObservations()
    owner?.fan({ observe: null })
    if (polling) return
    polling = true
    let poll = setInterval(async () => {
      try {
        await fetch(`${base()}/snapshot`, { method: 'HEAD' })
        // The server is back — but this tab may hold writes it made while the
        // socket was down. They leave through /apply before the reload that
        // would discard them (T-21413); a failed drain leaves the poller
        // running, so the next tick asks again.
        if (!(await drain())) return
        clearInterval(poll)
        polling = false
        owner?.fan('reload')
        setTimeout(config.reload)
      } catch { /* still down */ }
    }, 500)
  }
  return socket
}

// The follower half of the same promise: a fanned 'reload' must not outrun
// this tab's own outbox — nor refresh into a server a code edit is still
// restarting (the several-second brick). Confirm the successor is listening
// (HEAD /snapshot) AND this tab's outbox has drained, THEN reload; otherwise
// retry on the poller's cadence — the page stays live on the old JS across the
// gap. This is the same reachability gate the reconnect poller already uses.
let reloadDrained = async () => {
  try {
    await fetch(`${base()}/snapshot`, { method: 'HEAD' })
  } catch {
    return void setTimeout(reloadDrained, 500) // successor not up yet
  }
  if (await drain()) return config.reload()
  setTimeout(reloadDrained, 500)
}

let wire = (frame: unknown) => {
  let s = connect()
  let msg = JSON.stringify(frame)
  if (s.readyState == WebSocket.OPEN) s.send(msg)
  else s.addEventListener('open', () => s.send(msg), { once: true })
}

// An acked delivery threads its id through so a retry REPLACES its queued
// transport entry instead of piling up a duplicate per tick.
let route: (frame: unknown, id?: string) => void = (frame, id) =>
  owner ? owner.route(frame, id) : wire(frame)
// The transport seam (mirrors useOutboxStore): a test counts redelivery sends
// without a socket. Returns the prior route so the test can restore it.
export let useRoute = (fn: typeof route): typeof route => {
  let prev = route
  route = fn
  return prev
}
// THE change-batch door — every write leaves through the outbox, so no caller
// can fire and forget.
export let send = (...changes: unknown[]) => deliver(changes as Change[])

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
  // A queryEids sub (T-17126) republishes its per-sub signal on MEMBERSHIP change
  // only — a standing-match content frame leaves the set alone, and the member's
  // own row signal already carries that edit, so the list stays asleep for it.
  let had = querySignals.has(f.sub) ? new Set(old) : null
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
  if (had && membersChanged(had, mine)) {
    querySignals.get(f.sub)!.value = [...mine]
  }
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
      refreshQueries(gone)
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
// view opens), which streams those entries into the cache so boardScan's query
// door resolves them. Keyed by board sub → session eid → its unsubscribe. A
// cross-session lazy board (no `.entry.session=`, e.g. a `.generation.provider`
// board) has no single session to subscribe and stays unrenderable in the
// cache; the server query door answers it, board rendering waits on server-
// paged membership.
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

// The fullscreen root a client reaches by direct URL (or a peek) is one entity
// that no defining set holds and the query grammar can't name (`.eid=` is
// refused) — so a partial cache has nothing to render and the view blanks. A
// route sub loads it whole by id: `route:<eid>` streams that entity's comps and
// keeps them live (server derives the target from the sub name). Ref-counted so
// several views of one entity share a sub; a no-op under a whole-graph cache,
// where the entity is already loaded. Same ownership path as entrySub.
let routeUses = new Map<string, number>()
export let routeSub = (eid: string) => {
  if (!config.serverQuery) return () => {}
  let sub = `route:${eid}`
  let n = routeUses.get(sub) ?? 0
  routeUses.set(sub, n + 1)
  if (!n) ownBoard(sub, '')
  return () => {
    let held = (routeUses.get(sub) ?? 1) - 1
    if (held > 0) return void routeUses.set(sub, held)
    routeUses.delete(sub)
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
    // Undelivered writes leave through /apply BEFORE the page dies (T-21413);
    // a failed drain (server flickered again) retries on the poller's cadence
    // rather than reloading over the outbox.
    if (data == 'reload') setTimeout(reloadDrained)
    else if ('hmr' in data) {
      config.swap ? config.swap(data.hmr) : config.reload()
    } else config.css?.(data.css)
    return
  }
  if (data && typeof data == 'object' && 'ack' in data) {
    acked(String((data as { ack: unknown }).ack))
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
  if (frame.error) {
    // A rejected batch comes back with the authoritative state of the eids it
    // touched (server.ts correct()) — apply it to undo the optimistic write.
    // Its cursor is unchanged (nothing committed), so this only heals the cache.
    // A refusal settles the delivery: the outbox must not redeliver it. Capture
    // the refused batch from the outbox BEFORE acked() removes it, so the durable
    // refusal names the edit the server threw away — not the correction that heals
    // it. A frame with no id (a general socket error) keeps the ephemeral surface.
    let id = (frame as { id?: unknown }).id
    if (id) {
      refuse(String(id), String(frame.error), outbox.get(String(id))?.changes)
      acked(String(id))
    } else problem.value = String(frame.error)
    if (Array.isArray(frame.changes)) applyLocal(frame.changes)
    return
  }
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
    // serverQuery boots EMPTY (M-21143): the socket's ws:1 handshake seeds the
    // working set as its reset, so we skip the whole-graph HTTP /snapshot — the
    // dominant 44MB. A legacy client still fills from the full snapshot here.
    if (config.serverQuery) mark('working-set')
    else {
      mark('snapshot')
      await fromSnapshot(write)
    }
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
  // Requeue any write a prior life left undelivered, BEFORE the socket opens —
  // so a crash or manual reload can no longer silently lose it (T-21440).
  await replayOutbox()
  // Read back what a prior life left refused — the post-reload half of the
  // durability guarantee (T-21441): a drain refusal wiped by its own reload
  // returns to view instead of vanishing.
  loadRefusals()
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
  // Refocusing a tab that owns the socket must recover a stale connection
  // WITHOUT a manual reload (T-21511): a backgrounded tab is frozen, so its
  // watchdog and the socket both stall; on becoming visible, if this tab's
  // socket is closed or has heard nothing for WATCHDOG_MS, force-close it so the
  // onclose → poller → reconnect path runs. A live socket is left untouched (no
  // needless reload). A follower holds no socket and is unaffected here.
  let doc = (globalThis as { document?: Document }).document
  doc?.addEventListener?.('visibilitychange', () => {
    if (doc.visibilityState != 'visible' || !ws) return
    if (socketStale(ws.readyState, seen, Date.now())) ws.close()
  })
  config.serverQuery ||= serverQueryProbe(search)
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
    served: (line: string) => boolean
    subN: () => number
    subShapes: () => Record<string, number>
    subMembersOf: (line: string) => number
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
  // Whether THIS query opened a genuine server subscription (T-17126) — proof
  // the answer is server-authoritative, not a local cache scan; subN counts how
  // many are open across the tab.
  served: (line) => queryUses.has(qkey(resolveRefs(parseQuery(line), findEid))),
  subN: () => queryUses.size,
  // A histogram of open query subs by SHAPE (`comp.prop op`) — to see what a
  // page actually subscribes and prove the flip's sub count is bounded.
  subShapes: () => {
    let h: Record<string, number> = {}
    for (let s of queryUses.values()) {
      let p = s.preds[0]
      let key = !p
        ? 'empty'
        : p.refs
        ? '.refs'
        : `.${p.comp}${p.prop ? '.' + p.prop : ''}${
          p.op == EXISTS ? '!' : p.op ? p.op : '='
        }`
      h[key] = (h[key] ?? 0) + 1
    }
    return h
  },
  subMembersOf: (line) =>
    subEids(`q:${qkey(resolveRefs(parseQuery(line), findEid))}`)?.size ?? -1,
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
// comment → target, session → requested task or its actor, entry → its
// session. A seen set makes malformed cycles inert.
export let repoUrl = (start: Ent): string | undefined => {
  let seen = new Set<string>()
  let todo = [start]
  while (todo.length) {
    let e = todo.shift()!
    if (seen.has(e.eid)) continue
    seen.add(e.eid)
    if (e.repo?.url) return e.repo.url
    let next = [
      e.task?.project,
      e.comment?.target,
      e.session?.requested_task,
      e.session?.actor,
      e.role?.scope,
      e.memory?.scope,
      e.entry?.session,
    ].filter((eid): eid is string => !!eid)
    todo.push(...next.map(ent))
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

// The server id-resolve fallback (T-18102). Once the boot flip (T-18059)
// serves a WORKING SET, the cache is partial: a token naming a live-but-
// unloaded entity misses the vocabulary above, and navigation or a crumb
// would silently 404. This sidecar is the miss path — it asks the server's
// /resolve door (the same resolveId every read door uses) for the eid and the
// two immutable facts a link or crumb needs: its num and kind. NAMING-ONLY,
// never content — so nothing here reintroduces the content staleness a whole-
// cache seed carried (jeff C-3528); content still rides subscriptions.
//
// The reads (serverEid/serverName) stay SYNC and O(1): they answer from this
// sidecar and, on a first miss, KICK an async fetch and return "not yet". A
// render therefore never blocks and a navigation never hangs on the wire —
// resolveGen wakes the caller when an answer lands. A miss is BOUNDED: a slow
// server is aborted after RESOLVE_MS, and a failure cools for COOLDOWN_MS so a
// dead server can't drive a render→kick→fail retry storm, then heals on the
// next render (or a reconnect, which clears the sidecar). null means the
// server said "no such entity" — an honest Lost, not a pending spinner.
type Named = { eid: string; num: number; kind: string }
let named = new Map<string, Named | null>() // token OR eid -> naming (null = gone)
let resolvingIds = new Map<string, Promise<Named | null>>() // token -> in flight
let resolveFailed = new Map<string, number>() // token -> when its resolve failed
export let resolveGen = signal(0) // bumped when a resolve settles, to re-render
let RESOLVE_MS = 5000
let COOLDOWN_MS = 3000

let kickResolve = (token: string): Promise<Named | null> => {
  let found = resolvingIds.get(token)
  if (found) return found
  let ctrl = new AbortController()
  let timer = setTimeout(() => ctrl.abort(), RESOLVE_MS)
  let settle = (n: Named | null) => {
    clearTimeout(timer)
    resolvingIds.delete(token)
    resolveFailed.delete(token)
    named.set(token, n)
    if (n) named.set(n.eid, n) // resolvable by eid too, for the reverse read
    resolveGen.value++
    return n
  }
  let p = fetch(`${base()}/resolve?id=${encodeURIComponent(token)}`, {
    signal: ctrl.signal,
  })
    .then(async (r) => {
      if (r.status == 404) return settle(null) // genuine: no such entity
      if (!r.ok) throw new Error(await r.text())
      return settle((await r.json()) as Named)
    })
    // A slow or dead server is not "no such entity": don't poison the token —
    // cool it so a later render (or a reconnect) retries, and say what failed.
    .catch(() => {
      clearTimeout(timer)
      resolvingIds.delete(token)
      resolveFailed.set(token, Date.now())
      resolveGen.value++
      return null
    })
  resolvingIds.set(token, p)
  return p
}

// The sync read: a token's naming if a prior /resolve landed it, null if the
// server said it's gone, undefined while unknown or in flight — and a first
// miss (never asked, not cooling) KICKS the fetch. Reading resolveGen keeps
// the caller live to the landing.
let nameFor = (token: string): Named | null | undefined => {
  resolveGen.value // subscribe: a landing re-runs the reader
  if (named.has(token)) return named.get(token)!
  if (resolvingIds.has(token)) return undefined // in flight
  let failed = resolveFailed.get(token)
  if (failed && Date.now() - failed < COOLDOWN_MS) return undefined // cooling
  kickResolve(token)
  return undefined
}

// Forward: a token's eid via the server, or undefined while unknown/gone. The
// cache-side vocabulary (eidOf/findEid) tries this only after it misses.
export let serverEid = (token: string): string | undefined =>
  nameFor(token)?.eid

// Reverse: an unloaded eid's naming (num, kind) for a crumb chip — undefined
// while resolving, null once the server says it's gone.
export let serverName = (eid: string): Named | null | undefined => nameFor(eid)

// Whether a token is still being resolved (in flight or cooling after a
// failure) — the "resolving" state a router shows in place of a premature
// 404. A prior null (genuine miss) is NOT resolving.
export let resolvingId = (token: string): boolean => {
  resolveGen.value
  if (named.has(token)) return false
  let failed = resolveFailed.get(token)
  return resolvingIds.has(token) ||
    (!!failed && Date.now() - failed < COOLDOWN_MS)
}

// A reconnect reseeds the whole graph, so a token this client could not name
// while a socket was down may resolve now — clear the sidecar (resetSignals
// calls this) so the next render re-resolves rather than serving a stale miss.
export let clearResolved = () => {
  named.clear()
  resolvingIds.clear()
  resolveFailed.clear()
  resolveGen.value++
}
// The same query over the WHOLE graph — the board's List face. No task
// gate: sessions, memories, docs, web, people — anything that matches.
// Chrome stays out (a camera's updated.at churns with every pan and
// would drown any hot feed; cards/folds/shelves/clients are presence,
// not content), comments surface through their targets (the lately
// digest's rule), and a board is not news to itself.
let CHROME = new Set([
  'card',
  'camera',
  'fold',
  'shelf',
  'cursor',
  'client',
  'comment',
])
let chrome = (r: Comps) => [...CHROME].some((name) => r[name as keyof Comps])
export let boardPost = (
  e: Ent,
  tasks: boolean,
  eids: Iterable<string>,
): string[] =>
  [...eids].filter((eid) => {
    // Each member read through its OWN row signal, never `cache.value` — the
    // filter stays asleep on an unrelated patch and wakes on a member's edit
    // (a row gaining/losing `task` moves the tasks-only face), where a whole-
    // cache read would wake the board on every patch.
    let r = row(eid).value
    // Facets are the truth: a shelf is also a canvas, so kindOf cannot name
    // the chrome component that keeps it out of the feed.
    return !!r && (tasks ? !!r.task : eid != e.eid && !chrome(r))
  })

// A board's parsed, ref-resolved query, rebuilt each render — it THROWS on a
// bad query the way the scan did, so the consumers catch it and show the error.
// resolveRefs turns id references (T-3, P-19) into the eids the sub is keyed by.
let boardPreds = (e: Ent) =>
  resolveRefs(parseQuery(String(e.board?.query ?? '')), findEid)

// A board IS a saved query, so its membership is the SERVER's answer: the
// subscription boardSub installed (subEids) is the live, complete set — the
// server maintains the query, forward-path and reverse hops included, where a
// per-patch local re-test can't keep a complex board live (that was the whole-
// cache rescan this replaces), and it stays complete under a working-set boot
// where a cache scan would silently under-report (T-18094). It updates as tasks
// join or leave: a maintenance frame adds/drops the eid and wakes this read.
//
// Until the subscription's first frame lands (undefined — an empty Set is a
// ready, empty result), the query door answers from the cache so a board never
// flashes empty on mount; that pass is correct even for a complex board, since
// a one-shot resolve derefs forward. boardPost splits the one member set into
// the tasks-only and whole-graph faces and drops chrome/self (a board is not
// news to itself), reading each member through its own row signal — so the list
// sleeps through an unrelated patch and wakes on a member's edit.
let boardScan = (e: Ent, tasks: boolean): Ent[] => {
  let preds = boardPreds(e) // throws on a bad query, before either door
  let members = subEids(`board:${e.eid}`)
  if (!members) return boardPost(e, tasks, queryEids(preds).value).map(ent)
  let post = boardPost(e, tasks, members)
  // Pre-flip agreement (probe only, config.agreement): the local query door
  // must answer the same set the server streamed. The scan that used to be the
  // render source is gone; this compares the two doors that outlive it, so a
  // divergence still surfaces before the boot flip trusts the sub alone.
  if (config.agreement) {
    assertAgree(
      `board:${e.eid}`,
      String(e.board?.query ?? ''),
      boardPost(e, tasks, queryEids(preds).value),
      post,
    )
  }
  return post.map(ent)
}

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
    matchQuery(
      cache.peek()[eid] ?? {},
      preds,
      (t) => cache.peek()[t],
      undefined,
      kidsVia((t) => cache.peek()[t]),
    )
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

// The distinct domain census through the query door (T-17504): the universe is
// every task, and a wake-projected `task.domain` re-fires the set when a
// VALUE changes (a task moving Eng→Ops keeps its membership but changes the
// census) — the same mechanism a pin's move uses, so the bespoke facet-rescan
// machinery this replaces is gone. Empties drop in distinctValues, matching
// the census as it always read.
let censusPreds: Pred[] = [
  has('task'),
  {
    comp: '',
    prop: '',
    op: PROJECT,
    value: '',
    fields: [{ comp: 'task', prop: 'domain', wake: true }],
  },
]
export let domains = {
  get value() {
    return distinctValues(
      queryEids(censusPreds).value.map((eid) => cache.peek()[eid] ?? {}),
      { comp: 'task', prop: 'domain' },
    )
  },
}

// Presence/reference reads the query door answers directly: every project (by
// num, unknown last), every managed session (each riding its own row signal so
// a status change wakes it), and a client's single shelf (a unique client
// equality). No bespoke census to keep — refreshQueries maintains all three, and
// each face wakes only when ITS membership changes, not on a sibling facet.
export let projects = (): Ent[] =>
  queryEids([has('project')]).value
    .toSorted((a, b) =>
      (cache.peek()[a]?.entity?.num ?? Infinity) -
      (cache.peek()[b]?.entity?.num ?? Infinity)
    )
    .map(ent)
export let sessionRows = (): [string, Session][] =>
  queryEids([has('session')]).value.flatMap((eid) => {
    let s = sessionOf(row(eid).value ?? {})
    return s ? [[eid, s] as [string, Session]] : []
  })
export let shelfFor = (client: string): string | undefined =>
  queryEids([eq('shelf', 'client', client)]).value[0]

// The comments aimed HERE — every entity whose `comment.target` is this eid,
// an eid EQUALITY the refs index answers in O(result). A face subscribes to its
// own list (num-ordered) and tally; birth, death and retargeting update only the
// targets they affect. `.map(ent)` rides each note's own row signal, so a note
// edit wakes only the thread it is in.
export let commentsOn = (target: string): Ent[] =>
  queryEids([eq('comment', 'target', target)]).value
    .map(ent)
    .sort((a, b) => a.num - b.num)

// One actor's selected chat for one entity. chat(actor,target) is unique in
// SQLite and both columns are indexed in every cache backend, so this is a
// bounded lookup whose result alone wakes the aside.
export let chatFor = (actor: string, target: string): Ent | undefined =>
  queryEids([eq('chat', 'actor', actor), eq('chat', 'target', target)]).value
    .map(ent)[0]
// A per-tile badge on every rendered entity — LOCAL, never a per-entity server
// sub (T-21283). The open card's Comments view (commentsOn, bounded) owns the
// complete list; this count is best-effort over the working set.
export let commentCount = (target: string): Signal<number> =>
  computed(() => localEids([eq('comment', 'target', target)]).value.length)

type Folded = { eid: string; statuses: string }
// The fold row for a (client, board) — a unique (client, board) pair, so the two
// eid EQUALITIES the refs index answers narrow to ≤1 row. queryEids owns
// MEMBERSHIP (the fold's birth/death for this pair wakes the face); its live
// `statuses` field rides the fold's own row signal, so a collapse/expand edit
// wakes the face too without re-testing the whole cache.
export let foldFor = (client: string, board: string): Folded | undefined => {
  let eid = queryEids([
    eq('fold', 'client', client),
    eq('fold', 'board', board),
  ]).value[0]
  if (!eid) return undefined
  let f = row(eid).value?.fold
  return f && { eid, statuses: String(f.statuses ?? '') }
}

// The root canvas: the first canvas-tagged entity by num, read through the
// query door (`.canvas!`) rather than a whole-cache scan, so a partial cache
// resolves the same first canvas the complete graph would (T-18094). Membership
// wakes it when a canvas is minted or dies; `canvasVersion` when a num arrives —
// a canvas whose num hasn't landed yet can't be "first", or sorting the unknown
// to the front would yank every tab sitting on `/` to it.
export let rootCanvas = () => {
  canvasVersion.value
  return queryEids([has('canvas')]).value
    .map((eid) => [eid, cache.peek()[eid]] as const)
    .sort(([, a], [, b]) =>
      (a?.entity?.num ?? Infinity) - (b?.entity?.num ?? Infinity)
    )[0]
    ?.[0]
}

// The canvas working set: the carded pins on ONE canvas, scoped to it through
// the query door so opening a canvas reads its own contents rather than
// trusting the whole cache (T-18103) — under a partial cache a pin outside the
// loaded set still counts, where a scan silently dropped it. `.fields` PROJECTS
// each row's box (x/y/w/h) and card face (target/view) so a change to any of
// them re-fires the list — the same rows the old refreshPins re-published — plus
// `z~` VOLATILE: z's value rides along (seeding pinZ) but a z-bump on every
// toFront never re-fires the list, the raise binding straight to pinZ instead.
let pinFields: Field[] = [
  { comp: 'pin', prop: 'x', wake: true },
  { comp: 'pin', prop: 'y', wake: true },
  { comp: 'pin', prop: 'w', wake: true },
  { comp: 'pin', prop: 'h', wake: true },
  { comp: 'pin', prop: 'z', wake: false },
  { comp: 'card', prop: 'target', wake: true },
  { comp: 'card', prop: 'view', wake: true },
]
let pinsOn = (canvas: string): Pred[] => [
  eq('pin', 'canvas', canvas),
  has('card'),
  { comp: '', prop: '', op: PROJECT, value: '', fields: pinFields },
]

export let pinned = (canvas: string): Pinned[] =>
  (!canvas ? [] : queryEids(pinsOn(canvas)).value)
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

// Who points HERE, and via what: `.refs=target` is the multi-column reverse-
// union the vocabulary implies (refsTo above) — every entity referencing this
// eid through SOME {eid} column, resolved through the one query door. So a
// referrer OUTSIDE the working set still counts (T-18094), where the old
// whole-cache scan silently under-reported, and the face wakes only when its
// referrer set changes — never on an unrelated patch. The `via` label — WHICH
// column points here — is read per referrer off its OWN row signal (linksVia
// over the same refCols the union spans), so a referrer retargeting a pointer
// wakes the face too. A new association shows up with no second edit: this is
// how a task finds its sessions and Debug lists whatever holds a reference to
// the entity on screen.
type Backlink = { from: string; via: string }
let linksVia = (from: string, target: string): Backlink[] => {
  let r = row(from).value
  return !r ? [] : refCols
    .filter(([c, p]) =>
      (r[c as keyof typeof r] as Record<string, unknown>)?.[p] == target
    )
    .map(([c, p]) => ({ from, via: `${c}.${p}` }))
}
export let backlinks = (target: string): Backlink[] =>
  queryEids([refsTo(target)]).value.flatMap((from) => linksVia(from, target))

// The task a session is ON: the newest task it holds a claim over, else its
// managed request. The claims aimed at a session are an eid EQUALITY the refs
// index answers in O(result); membership is the only reactive edge (claimed_at
// is server-stamped at the claim's birth, never edited, and a release removes
// the row), so the face wakes exactly when its session gains or loses a claimed
// task — no bespoke per-session set to keep (T-17064).
export let jobOf = (e: Ent): string | null => {
  let g = cache.peek()
  return queryEids([eq('claim', 'session', e.eid), has('task')]).value
    .toSorted((a, b) =>
      String(g[b]?.claim?.claimed_at ?? '').localeCompare(
        String(g[a]?.claim?.claimed_at ?? ''),
      )
    )[0] ?? e.session?.requested_task ?? null
}

// The edges that hold an entity FROM ABOVE — every dependency whose child
// is this eid. refs/kids read downward; this is the climb back up, how a
// task names the parents that contain or require it.
export let parents = (eid: string) => childRelations(eid).value

// A board query carries refs as TEXT, outside the schema's eid columns, so a
// CONTAINS over `board.query` names every board mentioning this target. The pred
// anchors on the boards (byComp) and screens by substring — the same `.includes`
// the scan used, now through the one query door, so the target face watches only
// board rows that gain or lose its eid.
export let boardsOver = (target: string): string[] =>
  queryEids([contains('board', 'query', target)]).value

// The highest stacking order on a canvas — a raised card gets topZ + 1. The
// members come from the one canvas-scoped query (asleep on z-bumps), and each
// pin's CURRENT z is read fresh off the cache: a z-only patch updates the row
// in place without waking the list, so the max here is always live. A nullish
// canvas names no query and matches nothing, the floor 0.
export let topZ = (canvas: string) =>
  Math.max(
    0,
    ...(!canvas ? [] : queryEids(pinsOn(canvas)).value
      .map((eid) => cache.peek()[eid]?.pin?.z ?? 0)),
  )

// Any interaction pulls a card to the front. Reads the pins fresh from the
// cache, so a burst of events (a scroll's worth of wheels) raises once.
// The card must clear every OTHER pin, not merely match the canvas top —
// a tie at the top (fresh pins all land at 0) still raises.
export let toFront = (pin: string) => {
  let p = cache.value[pin]?.pin
  if (!p) return
  let top = Math.max(
    -1,
    ...queryEids(pinsOn(p.canvas)).value
      .filter((eid) => eid != pin)
      .map((eid) => cache.peek()[eid]?.pin?.z ?? -1),
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

// This client's camera over one canvas, if it exists yet — resolved through the
// query door (both {eid} columns anchor the derived index) rather than a
// whole-cache scan, so a partial cache still finds the row the graph holds.
export let myCamera = (client: string, canvas: string) =>
  queryEids([eq('camera', 'client', client), eq('camera', 'canvas', canvas)])
    .value
    .map((eid) => cache.peek()[eid]?.camera)
    .find((c) => !!c)

// This client's cursor — WHERE it's looking, one row per client (T-12788).
// Resolved through the query door (the client column anchors the derived unique
// index), never a whole-cache scan, so reading it in nav.tsx's follow effect
// stays O(1) and the hot render path never pays (M-17862). Reactive on BOTH the
// eid set (queryEids) AND the row's content (the per-row signal, not a peek), so
// an agent moving THIS cursor's target re-fires the follow — a peek would miss a
// same-eid target change, the whole point of "show you something".
export let myCursor = (client: string) =>
  queryEids([eq('cursor', 'client', client)])
    .value
    .map((eid) => row(eid).value?.cursor)
    .find((c) => !!c)

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
  left?: number
  top?: number
  w?: number
  h?: number
}
export let peek = signal<Peeked[]>([])

// The roots passed through, oldest first — the App bar wears the last few
// as breadcrumbs. Shell state for the same reason as peek: where the
// operator has BEEN outlives any hot swap of the components that got them
// there. nav.tsx owns how it is written (track()).
export let trail = signal<string[]>([])
