// One socket's serving half — the subscription registry, the live stream, and
// the catch-up handshake for a SINGLE client, parameterized by the db it reads
// and the send that reaches its socket. server.ts holds one instance per
// inline connection; a per-connection worker (wsworker.ts, D-22388 step 4)
// holds exactly one — same code, so the delegator split cannot fork frame
// semantics. This module depends on nothing in server.ts: everything it reads
// is a db-parameterized function, so a read-only connection serves as well as
// the writer's.
import type { Sql } from './store/sql.ts'
import type { Change, Dep } from './types.ts'
import { kindOrder, statusOf } from './types.ts'
import {
  aggOf,
  edgeRider,
  type EdgeSelector,
  type Field,
  fieldsOf,
  type Hop,
  listed,
  matchQuery,
  parseQuery,
  type Pred,
  predComps,
  resolveRefs,
  selected,
} from './query.ts'
import {
  cursorOf,
  cursorStale,
  delta,
  eager,
  eagerDeps,
  human,
  locate,
  referrersOf,
  refValuesOf,
  rootChanges,
  rowsOf,
  selectedDeps,
  sourceEntriesOf,
  textMatches,
  vocabOf,
} from './db.ts'
import { record } from './telemetry.ts'
import { evalAgg, evalSub, walker, workingSet } from './graph_query.ts'
import {
  inputsOf,
  resultDirty,
  resultsOf,
  type ResultState,
  resultStates,
  withResults,
} from './result_component.ts'
import type { ResultComp } from './query.ts'
import { liveFrame } from './wire.ts'
import { hasSources } from './source.ts'
import {
  bodied,
  bodyless,
  gaps,
  projected,
  spread,
  type Step,
  step,
  unedged,
} from './subs.ts'

// A Sub is this socket's saved query + the eids currently in its set. Shadow
// subs hear both streams for prove-before-flip; the later migration switch is
// still one boolean.
type Sub = {
  preds: Pred[]
  members: Set<string>
  shadow: boolean
  moving: boolean
  bodies: boolean
  details: boolean
  // The sub's PROJECTION (D-22567 §3): the columns its query DECLARED it reads
  // (`.fields=session.status`), or undefined for a full-component sub, which is
  // byte-identical to before. Every payload — the initial set, an ADD, a
  // standing-match patch — goes out through it, so a column the client never
  // asked for never rides, and a patch touching NO projected column projects to
  // nothing and is never sent. Projection is part of sub IDENTITY: the client
  // names its sub after the whole query line (live.ts serverSet), so the same
  // filter under two projections is two subs with two member sets, never one
  // set answering both.
  fields?: Field[]
  // That declaration compiled once, at subscribe — the cut every payload runs
  // through. Absent exactly when `fields` is.
  cut?: (changes: Change[]) => Change[]
  // A ROUTE sub (`route:<eid>`) names one entity by id, not a query — the
  // fullscreen root a client reaches by direct URL, which the query grammar
  // can't express (`.eid=` is refused, query.ts) and which no defining set
  // holds. `only` short-circuits the matcher to this fixed id: membership is
  // "this eid, while it's alive", so the entity loads whole (details), updates
  // live, and dies with the row. Empty/absent for every query sub.
  only?: Set<string>
  // An AGGREGATE sub (T-21283, D-22567 §1): a query carrying `.count!` /
  // `.tally=comp.prop` / `.distinct=col` answers a VALUE→COUNT map, not a member
  // list — one sub serves every tile's badge and every board tile's stats, so
  // neither a page of per-row reverse-lookups nor a board's whole membership
  // ever rides the wire. Nothing here is keyed by MEMBER: `counts` is the
  // standing answer (bounded by DISTINCT VALUES, not rows) and `line` re-answers
  // it with one indexed statement. `watch` is the dirty test — the components
  // the line reads, or null for "every batch dirties it". maintain() recomputes
  // a dirty aggregate and sends the DIFF (n=0 deletes a key).
  agg?: {
    line: string
    watch: Set<string> | null
    counts: Map<string, number>
  }
  // Query-result components are ordinary result data backed by declared,
  // bounded graph inputs. Standing dependency sets let one input edit refresh
  // one result without enumerating members or graph rows.
  results?: {
    names: ResultComp[]
    states: Map<string, Map<ResultComp, ResultState>>
  }
  // A WINDOWED sub (D-22567 §4): the members are a bounded PREFIX of the
  // query's matches — the newest `limit` by spine num — and the frame said so.
  // `.limit=` asks for one; SUB_CAP puts one under every row sub that asks for
  // nothing, so the cap that was implicit since 96f2e6b is now stated.
  //
  // A window is the one membership a per-eid delta cannot keep honest: a birth
  // pushes the oldest member out and a departure pulls the next-newest in, and
  // NEITHER of those rows is in the batch. So a dirtying batch RE-ANSWERS the
  // window from the index and ships the diff — the aggregate branch's shape,
  // for the same reason. Only when `exact`: a declining query's answer costs a
  // candidate scan to re-read (the 5s stall evalCapped exists to avoid), so it
  // keeps the per-eid maintenance and its frame states the bound alone.
  win?: {
    line: string
    limit: number
    total?: number
    watch: Set<string> | null
    exact: boolean
  }
  // The EDGES RIDER (`.edges!`, D-22567 §2, T-22371): this sub also owns the dep
  // triples INCIDENT to its members. That is the scoped delivery edges never
  // had — a joining client used to receive `allDeps`, every edge in the graph,
  // because nothing else could put an edge in a cache. `keys` is what this
  // client currently holds, so a delta says only what moved; `held` is the far
  // endpoints whose projected columns rode along, remembered so a later write to
  // one of them re-projects instead of going unnoticed.
  edges?: Rider
}
type Rider = {
  peers: Hop[]
  select?: EdgeSelector
  keys: Map<string, Dep>
  held: Set<string>
}

// What a subscription frame has to CARRY. A live subscription owns its
// client's view of these rows, so it ships the components. A SHADOW one does
// not: the client still hears the complete broadcast, and landSub() reads a
// shadow frame's changes for the eids only. Doc bodies ride only the subs that
// exist to show one entity whole (subs.ts bodied).
// The universal half of an aggregate's dirty test: whatever a line's preds
// name, EVERY query also reads the spine (a birth or a death moves any answer)
// and the quarantine facet (listed() screens on it). predComps names the rest.
let aggDirty = (watch: Set<string>, name: string) =>
  name == 'entity' || name == 'quarantined' || watch.has(name)

// The ONE payload seam: every Change this socket sends for a row sub passes
// here, so the initial set, an ADD and a standing-match patch can only agree
// about which columns exist.
//
// A PROJECTION wins over the body deferral where it names a column: bodyless is
// the DEFAULT cut (nobody declared what they read, so defer the class nobody
// reads), while a projection is a caller stating exactly what it reads — asking
// for `.fields=doc.body` is asking for the body, and silently withholding it
// would make the projection a lie about itself.
let carry = (sub: Sub, changes: Change[]) =>
  unedged(
    sub.cut ? sub.cut(changes) : sub.bodies ? changes : bodyless(changes),
  )

// A projected virtual task.status has no task-column patch to carry when one
// of its inputs moves. Re-project the current value onto the public read shape
// before applying the ordinary projection cut. A `~` field is explicitly
// non-waking, so only a waking task.status declaration gets this synthetic
// read patch; nothing on the write path ever sees it.
let carriedPatch = (
  sub: Sub,
  eid: string,
  comps: Record<string, Record<string, unknown>>,
  changes: Change[],
) => {
  let status =
    sub.fields?.some((f) => f.wake && f.comp == 'task' && f.prop == 'status') &&
    changes.some((c) =>
      c.name == 'completed' || c.name == 'cancelled' || c.name == 'claim'
    )
  return carry(
    sub,
    status && comps.task
      ? [...changes, {
        eid,
        name: 'task',
        comp: { status: statusOf(comps) },
      }]
      : changes,
  )
}

let payload = (
  sub: Sub,
  eid: string,
  comps: Record<string, Record<string, unknown>>,
): Change[] => {
  if (sub.shadow && !sub.details) {
    return [{ eid, name: 'entity', comp: comps.entity as Change['comp'] }]
  }
  let changes = spread(eid, comps)
  // Keyed/addressed reads hand payload() raw eager comps rather than rowed(),
  // so a projected virtual status needs the same read-shape materialization as
  // a query result. This is initial delivery only; carriedPatch handles moves.
  if (
    comps.task && !('status' in comps.task) &&
    sub.fields?.some((f) => f.comp == 'task' && f.prop == 'status')
  ) {
    changes.push({ eid, name: 'task', comp: { status: statusOf(comps) } })
  }
  return carry(sub, changes)
}

// An edge's identity is its whole sentence — a triple has no row key — so the
// rider keys by it and a re-linked edge is the same edge.
let depKey = (d: Dep) => `${d.parent}\0${d.type}\0${d.child}`

// The far endpoints these edges name that the member set does not already
// hold: exactly the rows a requires-tree needs in order to render, and exactly
// the ones a membership query never selected.
let outside = (deps: Iterable<Dep>, members: Set<string>) => {
  let out = new Set<string>()
  for (let d of deps) {
    if (!members.has(d.parent)) out.add(d.parent)
    if (!members.has(d.child)) out.add(d.child)
  }
  return out
}

// A peer row cut to its PROJECTION: the spine, so the client can name the
// entity, plus the columns `.edges.peers=` asked for and nothing else. A peer is
// not a subscription — it arrives because an edge points at it and leaves with
// that edge — so it must never carry a body or a component nobody asked for.
// One batched read for the whole set (rowsOf), never one eager() each.
let peerPayload = (
  db: Sql,
  peers: Hop[],
  eids: string[],
): Change[] => {
  if (!eids.length || !peers.length) return []
  let out: Change[] = []
  for (let { eid, comps } of rowsOf(db, eids)) {
    if (!comps.entity) continue
    out.push({ eid, name: 'entity', comp: comps.entity as Change['comp'] })
    let picked = new Map<string, Record<string, unknown>>()
    // A peer must be NAMEABLE, and kind is derived from which components an
    // entity wears — so its own kind component rides even when the projection
    // named no column on it, or the tree would render every blocker as whatever
    // kind the projected columns happened to imply. kindOrder is ordered, so the
    // FIRST present component is the kind, and shipping only that one gives the
    // peer exactly the kind the whole row has.
    let kind = kindOrder.find((c) => comps[c])
    if (kind) picked.set(kind, {})
    for (let h of peers) {
      // task.status is DERIVED (D-24102): compute it for a projected peer so the
      // requires-tree renders a blocker's status without a stored column.
      let v = h.comp == 'task' && h.prop == 'status'
        ? (comps.task ? statusOf(comps) : undefined)
        : comps[h.comp]?.[h.prop]
      if (v == null) continue
      picked.set(h.comp, { ...picked.get(h.comp), [h.prop]: v })
    }
    for (let [name, comp] of picked) {
      out.push({ eid, name, comp: comp as Change['comp'] })
    }
  }
  return out
}

// Open a rider over a fresh member set: its incident edges, the far endpoints
// they name, and the state every later delta speaks from.
let riderOpen = (
  db: Sql,
  peers: Hop[],
  members: Set<string>,
  select?: EdgeSelector,
) => {
  let deps = members.size
    ? select
      ? selectedDeps(db, [...members], select)
      : eagerDeps(db, [...members])
    : []
  let held = outside(deps, members)
  let state: Rider = {
    peers,
    ...(select ? { select } : {}),
    keys: new Map(deps.map((d) => [depKey(d), d])),
    held,
  }
  return {
    state,
    frame: { edges: deps, peers: peerPayload(db, peers, [...held]) },
  }
}

// Several stored sentences may collapse to one projected sentence (many
// entries in one Session can cite the same target). Re-answer the bounded,
// indexed selector when its inputs move, then diff against the standing map:
// removing one stored edge cannot withdraw a projection another still proves.
let selectedRiderDelta = (
  db: Sql,
  r: Rider,
  members: Set<string>,
  joined: string[],
  moved: boolean,
  batch: Change[],
  touched: string[],
) => {
  let select = r.select!
  let dirty = !!joined.length || moved ||
    batch.some((c) =>
      c.name == select.via?.comp ||
      (c.name == 'dependency' && c.comp?.type == select.type) ||
      (c.name == 'entity' && c.comp == null)
    )
  let add: Dep[] = []
  let cut: Dep[] = []
  if (dirty) {
    let deps = members.size ? selectedDeps(db, [...members], select) : []
    let next = new Map(deps.map((d) => [depKey(d), d]))
    add = deps.filter((d) => !r.keys.has(depKey(d)))
    cut = [...r.keys].filter(([k]) => !next.has(k)).map(([, d]) => d)
    r.keys = next
  }
  let peers: Change[] = []
  let unpeers: string[] = []
  let fresh = new Set<string>()
  if (add.length || cut.length) {
    let want = outside(r.keys.values(), members)
    fresh = new Set([...want].filter((e) => !r.held.has(e)))
    unpeers = [...r.held].filter((e) => !want.has(e))
    r.held = want
    peers = peerPayload(db, r.peers, [...fresh])
  }
  let again = touched.filter((e) => r.held.has(e) && !fresh.has(e))
  if (again.length) peers = [...peers, ...peerPayload(db, r.peers, again)]
  return { edges: add, unedges: cut, peers, unpeers }
}

let resultDelta = (
  db: Sql,
  d: NonNullable<Sub['results']>,
  members: Set<string>,
  batch: Change[],
): Change[] => {
  let out: Change[] = []
  for (let eid of [...d.states.keys()]) {
    if (members.has(eid)) continue
    for (let name of d.states.get(eid)?.keys() ?? []) {
      out.push({ eid, name, comp: null })
    }
    d.states.delete(eid)
  }
  for (let eid of members) {
    let old = d.states.get(eid)
    let dirty = !old || d.names.some((name) => {
      let state = old.get(name)
      return !state || resultDirty(db, name, state, batch)
    })
    if (!dirty) continue
    let next = resultStates(db, d.names, [eid]).get(eid)!
    d.states.set(eid, next)
    for (let [name, state] of next) {
      let before = old?.get(name)?.comp ?? null
      if (JSON.stringify(before) != JSON.stringify(state.comp)) {
        out.push({ eid, name, comp: state.comp })
      }
    }
  }
  return out
}

// Did a delta actually MOVE anything? A rider that says nothing must not put a
// frame on the wire — every sub with edges would otherwise speak on every batch.
let rider = (d: ReturnType<typeof riderDelta>) =>
  !!(d.edges.length || d.unedges.length || d.peers.length || d.unpeers.length)

// What ONE committed batch does to a rider — bounded by the delta, never by the
// graph. A member that JOINED brings its whole incident set (one keyed read); an
// edge WRITTEN in the batch moves at both its endpoints, so it joins or leaves
// by whether either endpoint is a member; a member that DIED takes every edge
// touching it (apply() deletes those rows, casting no per-edge change), and one
// that merely LEFT the set takes the edges no remaining member holds. Then the
// far-endpoint projection is re-derived — only when something actually moved —
// and a touched eid that IS a held peer re-projects, so a blocker's status
// reaches the tree without a subscription per blocker.
let riderDelta = (
  db: Sql,
  r: Rider,
  members: Set<string>,
  joined: string[],
  moved: boolean,
  gone: Set<string>,
  batch: Change[],
  touched: string[],
) => {
  if (r.select) {
    return selectedRiderDelta(db, r, members, joined, moved, batch, touched)
  }
  let add: Dep[] = []
  let cut: Dep[] = []
  let take = (d: Dep) => {
    let k = depKey(d)
    if (r.keys.has(k)) return
    r.keys.set(k, d)
    add.push(d)
  }
  let lose = (k: string) => {
    let d = r.keys.get(k)
    if (!d) return
    r.keys.delete(k)
    cut.push(d)
  }
  if (joined.length) { for (let d of eagerDeps(db, joined)) take(d) }
  // Whether an edge may be DELIVERED is one question with one answer — the eager
  // screen — so rather than re-deciding it here, ask the same reader about the
  // endpoints the batch named and believe what comes back. An unlink needs no
  // such ask: gone is gone.
  let linked = batch.filter((c) => c.name == 'dependency' && c.comp)
  let admits = new Set<string>()
  if (linked.some((c) => !c.comp!.gone)) {
    let ends = linked.flatMap((c) => [c.eid, String(c.comp!.child)])
    for (let d of eagerDeps(db, ends)) admits.add(depKey(d))
  }
  for (let c of linked) {
    let d: Dep = {
      parent: c.eid,
      type: String(c.comp!.type) as Dep['type'],
      child: String(c.comp!.child),
    }
    let ours = members.has(d.parent) || members.has(d.child)
    if (c.comp!.gone || !ours || !admits.has(depKey(d))) lose(depKey(d))
    else take(d)
  }
  if (gone.size || moved) {
    for (let [k, d] of [...r.keys]) {
      if (gone.has(d.parent) || gone.has(d.child)) lose(k)
      else if (!members.has(d.parent) && !members.has(d.child)) lose(k)
    }
  }
  let peers: Change[] = []
  let unpeers: string[] = []
  if (add.length || cut.length) {
    let want = outside(r.keys.values(), members)
    let fresh = [...want].filter((e) => !r.held.has(e))
    unpeers = [...r.held].filter((e) => !want.has(e))
    r.held = want
    peers = peerPayload(db, r.peers, fresh)
  }
  // A held peer someone WROTE to re-projects: it is nobody's member, so no
  // membership pass would have noticed the edit its edge exists to show.
  let again = touched.filter((e) => r.held.has(e) && !gone.has(e))
  if (again.length) peers = [...peers, ...peerPayload(db, r.peers, again)]
  return { edges: add, unedges: cut, peers, unpeers }
}

// A path member can move when any row along its reference chain changes, not
// only when the source itself changes. Walk each possible touched rung back to
// the source through the predicate's own columns. The reverse queries are
// component-keyed; ordinary subscriptions keep the touched-eid fast path.
let pathSources = (db: Sql, preds: Pred[], touched: string[]) => {
  let out = new Set(touched)
  for (let p of preds) {
    // A reverse hop: a touched CHILD moves its PARENT — read the child's ref
    // column back to the entity it points at. The sub-filter's own hops are
    // recomputed from the parent by matchQuery, so they need no separate
    // invalidation here.
    if (p.rev) {
      for (
        let eid of refValuesOf(db, touched, {
          comp: p.rev.comp,
          prop: p.rev.prop,
        })
      ) out.add(eid)
      continue
    }
    if (!p.at) continue
    let refs = [{ comp: p.comp, prop: p.prop }, ...p.at.slice(0, -1)]
    for (let depth = 1; depth <= refs.length; depth++) {
      let found = touched
      for (let at = depth - 1; at >= 0 && found.length; at--) {
        found = referrersOf(db, found, refs[at])
      }
      for (let eid of found) out.add(eid)
    }
  }
  return [...out]
}

// A reverse hop's Kids over the db: the children referring at `eid` through
// `comp.prop` (referrersOf), each hydrated to its eager bag by `read`, bound
// per pass to that pass's memoised fetcher.
export let dbKids = (
  db: Sql,
  read: (eid: string) => Record<string, Record<string, unknown>>,
) =>
(eid: string, comp: string, prop: string) =>
  referrersOf(db, [eid], { comp, prop }).map((k) => read(k))

// One entity as a subscription hit — its eager comps, or nothing if the id
// names no live entity yet (a route sub opened before its target is minted, or
// on a tombstone). Shaped like an evalFast/evalQuery hit so control() ships it
// through the one payload path.
let rowsFor = (
  db: Sql,
  eids: Iterable<string>,
): { eid: string; comps: Record<string, Record<string, unknown>> }[] => {
  let out: { eid: string; comps: Record<string, Record<string, unknown>> }[] =
    []
  for (let eid of eids) {
    let comps = eager(db, eid)
    if (comps.entity) out.push({ eid, comps })
  }
  return out
}

// What this half hands its socket: a frame, as a VALUE. Serializing it is the
// socket's business, not the subscription machinery's — which is what lets a
// door project a frame before it goes out (workers/yak/store.ts answers an
// app's page with the listing rows its /query door answers with).
export type Frame = Record<string, unknown> | Change[]

export type Subserve = ReturnType<typeof subserve>

export let subserve = (db: Sql, send: (frame: Frame) => void) => {
  let map = new Map<string, Sub>()
  // `joined` = the {since} handshake ran, so the live stream may reach this
  // socket; `filtered` = a non-shadow sub owns the socket's cache, so the
  // complete stream must NOT. A socket that declared neither hears nothing.
  let joined = false
  let filtered = false
  let envelope = false

  // A socket's control frame: `{sub, q}` subscribes or replaces (the initial
  // frame is the query's current matches as one batch, and seeds the member
  // set, marked `replace` for the client); `{unsub}` forgets one.
  let control = (
    f: { sub?: string; q?: string; unsub?: string; shadow?: boolean },
  ) => {
    // A shadow subscription proves its set beside the complete stream. It must
    // not flip the socket into partial-cache delivery before stage 2c.
    if (typeof f.sub == 'string' && !f.shadow) filtered = true
    if (typeof f.unsub == 'string') return void map.delete(f.unsub)
    if (typeof f.sub != 'string') return
    try {
      // A route sub names one entity by id in its own name — no query to eval;
      // its hits are that entity's current comps (empty if it isn't minted
      // yet, so a later create ADDs it). A query sub evaluates its filter.
      let route = f.sub.startsWith('route:')
        ? f.sub.slice('route:'.length)
        : null
      let line = f.q ?? ''
      let parts = line.split('&').filter(Boolean)
      let names = route == null
        ? parts.filter((p) => p.startsWith('id='))
          .flatMap((p) => p.slice(3).split(',')).filter(Boolean)
        : []
      let named = names.length
        ? names
          .map((id) => locate(db, id)).filter((eid): eid is string => !!eid)
        : []
      let addressed = route != null || names.length > 0
      let only = route != null ? [route] : [...new Set(named)]
      let queryLine = parts.filter((p) => !p.startsWith('id=')).join('&')
      let details = addressed || f.sub.startsWith('entries:')
      // An aggregate sub answers a VALUE, so it never enumerates members — not
      // even once, at subscribe. Parse the line, and if it carries an AGG
      // projection let evalAgg answer it with one indexed statement; only a
      // membership sub pays evalSub's row set. A bare `id=` sub strips to an
      // EMPTY residual query, and parseQuery('') is the never-pred — so guard
      // it to [] the way /query does: the addressed row must flow through
      // matchQuery (vacuously true on []), never be filtered out as if the
      // never-pred screened it (T-23811).
      let asked = route != null || !queryLine.trim()
        ? []
        : resolveRefs(parseQuery(queryLine, vocabOf(db)), (id) =>
          locate(db, id))
      if (aggOf(asked)) {
        let counts = evalAgg(db, queryLine)?.values ?? new Map<string, number>()
        map.set(f.sub, {
          preds: [],
          members: new Set(),
          shadow: !!f.shadow,
          moving: false,
          bodies: false,
          details: false,
          agg: { line: queryLine, watch: predComps(inputsOf(asked)), counts },
        })
        send({
          sub: f.sub,
          agg: Object.fromEntries(counts),
          replace: true,
          cursor: cursorOf(db),
          shadow: !!f.shadow,
        })
        return
      }
      // An empty query SELECTS NOTHING (query.ts parseQuery mints the
      // never-pred), so an empty sub legitimately answers the empty set —
      // cheap, no error. Only a route sub carries meaning with no query: its
      // name scopes it to one entity.
      let answer = addressed
        ? {
          preds: asked,
          hits: withResults(db, asked, rowsFor(db, only)).filter((r) =>
            listed(r.comps, asked) && matchQuery(r.comps, asked)
          ),
        }
        : evalSub(db, queryLine, details)
      let { preds, hits } = answer
      // entriesOf keeps its legacy array return for graph readers, so a source
      // refusal would otherwise collapse to the same [] as an authoritative
      // empty transcript. The stable partition subscription is where that
      // distinction becomes protocol state: only an empty answer needs the
      // source-side outcome checked, and an undiscoverable source remains a
      // legitimate empty lookup.
      if (
        !hits.length && hasSources() && f.sub.startsWith('entries:')
      ) {
        let session = f.sub.slice('entries:'.length)
        let source = sourceEntriesOf(db, session)
        if (source.state == 'failed') {
          throw new Error(
            `entry source ${source.reason} for ${human(db, session)}`,
          )
        }
      }
      let window = 'window' in answer ? answer.window : undefined
      // The declared projection, compiled once. A route sub never has one: it
      // exists to load ONE entity whole, which is the opposite ask.
      let fields = route != null ? undefined : fieldsOf(preds)
      // A route sub's SCOPE rides in its name, but its query line may still
      // carry riders (`id=<eid>&.edges!`). `id=` is an ADDRESS, not a filter —
      // the same split localQuery makes — so strip it and parse whatever
      // remains, which is how a route sub declares it wants its edges too.
      let rides = route == null ? preds : parseQuery(queryLine, vocabOf(db))
      let members = new Set(hits.map((r) => r.eid))
      let resultNames = resultsOf(rides)
      let results = resultNames.length
        ? {
          names: resultNames,
          states: resultStates(db, resultNames, members),
        }
        : undefined
      // The rider is opened with the member set, so its first frame carries
      // this query's edges and nothing else's — the scoped answer that replaces
      // the whole-graph dump a joining client used to be handed (T-22371).
      let ask = edgeRider(rides)
      let ride = ask ? riderOpen(db, ask.peers, members, ask.select) : undefined
      map.set(f.sub, {
        preds,
        members,
        shadow: !!f.shadow,
        // Materialization warmth decays against the clock, so a result-component
        // sub joins the existing aged() sweep. Re-reading stays bounded to its
        // addressed member closure.
        moving: gaps(preds).includes('moving-time') || !!results,
        bodies: bodied(f.sub),
        // Entry partitions and route entities are absent from both the root
        // snapshot and root live stream, so their shadow owns bodies and
        // standing-match updates too.
        details,
        ...(fields ? { fields, cut: projected(fields) } : {}),
        ...(only.length ? { only: new Set(only) } : {}),
        ...(window
          ? {
            win: {
              line,
              limit: window.limit,
              total: window.total,
              watch: predComps(inputsOf(asked)),
              exact: !!('exact' in answer && answer.exact),
            },
          }
          : {}),
        ...(ride ? { edges: ride.state } : {}),
        ...(results ? { results } : {}),
      })
      let sub = map.get(f.sub)!
      let changes = hits.flatMap((r) => payload(sub, r.eid, r.comps))
      send(
        {
          sub: f.sub,
          changes,
          drop: [],
          replace: true,
          cursor: cursorOf(db),
          shadow: !!f.shadow,
          // A bounded answer SAYS it is bounded. An answer that is whole says
          // nothing, so an unwindowed sub's frame is exactly what it was.
          ...(window ? { window } : {}),
          // And it STATES its projection the same way: the client asked for it,
          // but a frame carrying the contract is one the client can believe
          // without re-deriving it, and landSub is what turns the statement
          // into the cache's column-level loaded/unloaded mark.
          ...(fields ? { fields } : {}),
          ...(ride ? ride.frame : {}),
        },
      )
    } catch (e) {
      // A subscription is a read request with an addressed caller waiting for
      // its initial replacement. Silence here leaves that caller in loading
      // forever. Keep the read failure outside the graph (it is telemetry, not
      // a failure of the Session being read), and answer the exact stable sub
      // identity so a retry can replace it normally.
      let message = e instanceof Error ? e.message : String(e)
      let session = f.sub.startsWith('entries:')
        ? f.sub.slice('entries:'.length)
        : undefined
      let reference = session
        ? `entries:${human(db, session)}`
        : `subscription:${f.sub}`
      record(db, {
        source: 'srv',
        name: 'subscription read',
        session_id: session ?? null,
        ok: false,
        error: message,
        detail: reference,
      })
      send({
        sub: f.sub,
        changes: [],
        replace: true,
        error: message,
        reference,
        cursor: cursorOf(db),
        shadow: !!f.shadow,
      })
    }
  }

  // The catch-up handshake (T-6829): the client declares the cursor+epoch+
  // vocab it holds; this side replays the journal since it — or a full reset
  // if the cursor is void or its epoch/vocab moved — and only THEN opens the
  // live stream, so every later commit reaches it AFTER its catch-up, in
  // journal order. `drain` is the caller's chance to settle its feed first so
  // an unsettled foreign commit can't arrive twice (inline mode); a worker
  // needs none, because its casts arrive through the same serialized message
  // queue as this frame — a commit racing the join lands in the delta AND as a
  // later cast, a dup the wire contract absorbs, never a gap.
  let join = (
    f: { since?: number; epoch?: string; vocab?: string; live?: number },
    drain?: () => void,
  ) => {
    drain?.()
    envelope = f.live == 1
    if (f.since == null || cursorStale(db, f.epoch, f.vocab, f.since)) {
      // A cold or stale client seeds the WORKING SET — never the whole graph
      // (M-21143); its subscriptions stream the rest on demand.
      send({ reset: true, snapshot: workingSet(db) })
    } else {
      let d = delta(db, f.since)
      send({ catchup: d.changes, cursor: d.cursor })
    }
    joined = true
  }

  // Route a parsed control-object frame ({since} vs {sub}/{unsub}). Write
  // batches never reach here — the delegator applies them in the writer
  // process.
  let frame = (f: Record<string, unknown>, drain?: () => void) =>
    'since' in f ? join(f, drain) : control(f)

  // The live stream: one committed batch, root-projected, in the shape this
  // socket negotiated — skipped entirely once a non-shadow sub owns the cache.
  let live = (changes: Change[], cursor: number) => {
    if (!joined || filtered) return
    let rooted = rootChanges(db, changes)
    if (!rooted.length) return
    send(liveFrame(rooted, cursor, envelope))
  }

  // Fold a committed batch into every subscription, synchronously — no await
  // between the caller's commit knowledge and these frames. Per candidate eid
  // × sub: one eager keyed read (batch-cached), then the transition — ADD
  // queues full comps, UPDATE queues the batch's own patches, REMOVE pushes a
  // drop, a death forwards entity-null.
  let maintain = (batch: Change[], cur = cursorOf(db)) => {
    if (!map.size) return
    let gone = new Set(
      batch.filter((c) => c.name == 'entity' && c.comp == null).map((c) =>
        c.eid
      ),
    )
    let touched = [...new Set(batch.map((c) => c.eid))]
    let reads = new Map<string, Record<string, Record<string, unknown>>>()
    let comps = (eid: string) => {
      let hit = reads.get(eid)
      if (!hit) reads.set(eid, hit = eager(db, eid))
      return hit
    }
    let patch = new Map<string, Change[]>()
    for (let c of batch) patch.set(c.eid, [...(patch.get(c.eid) ?? []), c])
    // One traversal memo for the whole pass: a `.reaches` sub's closure is the
    // same for every candidate eid, and re-resolving it per row would put a
    // recursive walk on the write path.
    let walk = walker(db)
    let fts = (eid: string, p: Pred) => textMatches(db, eid, p)
    for (let [id, sub] of map) {
      // An aggregate sub speaks value→count deltas. The batch DIRTIES it only
      // if it touches a component the line reads (D-22567 §1) — an unrelated
      // write costs one Set lookup per changed component and nothing else. A
      // dirty aggregate re-answers from the INDEX (evalAgg: count/group-by over
      // indexed columns, µs) and ships the DIFF against the standing answer, so
      // a birth, a death and a moved value all fall out of one recompute
      // without a per-member map to keep honest. n=0 tells the client to drop
      // the key.
      if (sub.agg) {
        let { line, watch, counts } = sub.agg
        if (watch && !batch.some((c) => aggDirty(watch, c.name))) continue
        let next = evalAgg(db, line)?.values ?? new Map<string, number>()
        let delta = new Map<string, number>()
        for (let [v, n] of next) if (counts.get(v) != n) delta.set(v, n)
        for (let v of counts.keys()) if (!next.has(v)) delta.set(v, 0)
        sub.agg.counts = next
        if (delta.size) {
          send({
            sub: id,
            agg: Object.fromEntries(delta),
            cursor: cur,
            shadow: sub.shadow,
          })
        }
        continue
      }
      // An EXACT window re-answers rather than patching: the rows that cross
      // its edge are precisely the ones no batch mentions, so a per-eid pass
      // cannot see them. One indexed statement gives the new page; the diff
      // against the standing members is what the client hears — an add for a
      // row that entered, a drop for one the edge pushed out, and the batch's
      // own patches for members that merely changed. Gated by the same
      // component-overlap dirty test the aggregates use, so an unrelated write
      // costs one Set lookup.
      if (sub.win?.exact) {
        let { line, watch, limit } = sub.win
        if (watch && !batch.some((c) => aggDirty(watch, c.name))) continue
        let answer = evalSub(db, line, sub.details, limit)
        let next = new Set(answer.hits.map((r) => r.eid))
        let changes: Change[] = []
        let drop: string[] = []
        let entered: string[] = []
        let left = false
        for (let r of answer.hits) {
          if (!sub.members.has(r.eid)) {
            changes.push(...payload(sub, r.eid, r.comps))
            entered.push(r.eid)
          } else if (patch.has(r.eid) && (!sub.shadow || sub.details)) {
            changes.push(
              ...carriedPatch(sub, r.eid, r.comps, patch.get(r.eid)!),
            )
          }
        }
        for (let eid of sub.members) {
          if (next.has(eid)) continue
          left = true
          if (gone.has(eid)) changes.push({ eid, name: 'entity', comp: null })
          else drop.push(eid)
        }
        sub.members = next
        // The total moves without membership moving — a match beyond the edge
        // is still a match — so the window is restated whenever it changed,
        // even on a frame carrying no rows. A sub that was bounded keeps
        // stating its bound even once the answer fits inside it, or the client
        // would be left holding a window nobody withdrew.
        let win = answer.window ?? { limit, total: answer.hits.length }
        let moved = win.total != sub.win.total
        sub.win.total = win.total
        // A window and a rider compose: the members are a bounded prefix, and
        // the edges are the ones incident to THAT prefix. A row scrolling out
        // of the window takes its edges with it exactly as a departure does.
        let ride = sub.edges &&
          riderDelta(
            db,
            sub.edges,
            sub.members,
            entered,
            left,
            gone,
            batch,
            touched,
          )
        let rode = ride && rider(ride)
        let resultChanges = sub.results && resultDelta(
          db,
          sub.results,
          sub.members,
          batch,
        )
        if (resultChanges?.length) changes.push(...resultChanges)
        if (
          changes.length || drop.length || moved || rode
        ) {
          send({
            sub: id,
            changes,
            drop,
            cursor: cur,
            shadow: sub.shadow,
            window: win,
            ...(rode ? ride : {}),
          })
        }
        continue
      }
      let changes: Change[] = []
      let drop: string[] = []
      let entered: string[] = []
      let candidates = sub.preds.some((p) => p.at || p.rev)
        ? pathSources(db, sub.preds, touched)
        : touched
      for (let eid of candidates) {
        let c = gone.has(eid) ? {} : comps(eid)
        let alive = !gone.has(eid) && !!c.entity
        let projected = alive && sub.results
          ? withResults(db, sub.preds, [{ eid, comps: c }])[0].comps
          : c
        // A route sub matches its fixed id; a query sub runs the matcher.
        let hit = alive &&
          (sub.only ? sub.only.has(eid) : selected(projected, sub.preds) &&
            matchQuery(
              projected,
              sub.preds,
              comps,
              undefined,
              dbKids(db, comps),
              walk,
              fts,
            ))
        let s: Step = step(sub.members, eid, alive, hit)
        if (s == 'add') {
          changes.push(...payload(sub, eid, projected))
          entered.push(eid)
        } // A standing match tells a shadow sub nothing: membership did not
        // move, and the client heard the patch on the complete stream.
        else if (s == 'update' && (!sub.shadow || sub.details)) {
          changes.push(
            ...carriedPatch(sub, eid, projected, patch.get(eid) ?? []),
          )
        } else if (s == 'remove') drop.push(eid)
        else if (s == 'dead') changes.push({ eid, name: 'entity', comp: null })
      }
      let ride = sub.edges &&
        riderDelta(
          db,
          sub.edges,
          sub.members,
          entered,
          drop.length > 0,
          gone,
          batch,
          touched,
        )
      let rode = ride && rider(ride)
      let resultChanges = sub.results && resultDelta(
        db,
        sub.results,
        sub.members,
        batch,
      )
      if (resultChanges?.length) changes.push(...resultChanges)
      if (changes.length || drop.length || rode) {
        send({
          sub: id,
          changes,
          drop,
          cursor: cur,
          shadow: sub.shadow,
          ...(rode ? ride : {}),
        })
      }
    }
  }

  // One committed batch, both halves in the maintained order: the live stream
  // reaches complete-broadcast clients BEFORE maintain() runs, so a client
  // always holds an entity's components before a shadow frame mentions its eid.
  let cast = (changes: Change[], cursor: number) => {
    live(changes, cursor)
    maintain(changes, cursor)
  }

  // A moving time phrase names a window the CLOCK moves, not the data — so a
  // member ages out of it with nobody writing anything, and maintain() only
  // ever re-tests what a batch touched. On each tick, every moving-time
  // subscription re-tests its OWN members against the clock and drops the ones
  // that have fallen out (drop-only is exact for past-facing windows; a
  // future-facing gain still classifies as a gap in subs.ts).
  let aged = (now = Date.now()) => {
    let cur = cursorOf(db)
    let walk = walker(db)
    let fts = (eid: string, p: Pred) => textMatches(db, eid, p)
    let reads = new Map<string, Record<string, Record<string, unknown>>>()
    let comps = (eid: string) => {
      let hit = reads.get(eid)
      if (!hit) reads.set(eid, hit = eager(db, eid))
      return hit
    }
    for (let [id, sub] of map) {
      if (!sub.moving) continue
      let changes: Change[] = []
      let drop: string[] = []
      for (let eid of [...sub.members]) {
        let c = comps(eid)
        let alive = !!c.entity
        let projected = alive && sub.results
          ? withResults(db, sub.preds, [{ eid, comps: c }], now)[0].comps
          : c
        let hit = alive && selected(projected, sub.preds) &&
          matchQuery(
            projected,
            sub.preds,
            comps,
            now,
            dbKids(db, comps),
            walk,
            fts,
          )
        let s: Step = step(sub.members, eid, alive, hit)
        if (s == 'remove') drop.push(eid)
        else if (s == 'dead') changes.push({ eid, name: 'entity', comp: null })
      }
      let resultChanges = sub.results && resultDelta(
        db,
        sub.results,
        sub.members,
        [...sub.members].map((eid) => ({
          eid,
          name: 'recall',
          comp: {},
        })),
      )
      if (resultChanges?.length) changes.push(...resultChanges)
      if (changes.length || drop.length) {
        send({
          sub: id,
          changes,
          drop,
          cursor: cur,
          shadow: sub.shadow,
        })
      }
    }
  }

  // A session observation reaches only the sockets holding that session's
  // entries partition open. Returns whether this one sent.
  let observe = (frame: Frame, session: string) => {
    if (!map.has(`entries:${session}`)) return false
    send(frame)
    return true
  }

  return { frame, cast, maintain, aged, observe }
}
