// The authoritative filter-query pipeline — the one answer the /query door, a
// subscription's initial set, and the in-process graph_query tool all read, so
// none can drift onto snapshot()-only truth. The index (sql.ts → matching())
// answers when it can; otherwise the JS matcher over the full universe. That
// universe is the eager graph PLUS, whenever a query names the lazy entry
// partition (`.entry.session=…`, `.generation.provider=…`), its entries — which
// the root snapshot omits. Entries page by their server seq; the eager graph
// answers whole in num order.
//
// Parameterized by db so a test drives it against an in-memory graph without
// booting the server (server.ts owns the one live db and closes over it at each
// call site). sql_test.ts holds the index and the matcher against each other,
// entry predicates included, so the fast path cannot silently disagree.
import type { DatabaseSync } from './sqlite.ts'
import {
  capabilities,
  type Change,
  deaths,
  type Dep,
  kindOf,
  sessionOf,
  type Snapshot,
} from './types.ts'
import { find, need, type Querier, type Row } from './client.ts'
import type { Reader } from './commands.ts'
import {
  allDeps,
  buried,
  cursorOf,
  depsOf,
  eager,
  entriesOf,
  entriesScan,
  epochOf,
  locate,
  matching,
  referrersOf,
  vocabHash,
} from './db.ts'
import { aggregateSql, where, whereSome } from './sql.ts'
import {
  aggOf,
  listed,
  matchQuery,
  namesLazy,
  ORDER,
  orderOf,
  parseQuery,
  type Pred,
  resolveRefs,
  scopedSessions,
  tally,
  warm,
} from './query.ts'

// A filter of only rankings — or of nothing at all — selects EVERY entity, and
// there the index has nothing to offer: matching() would read every row through
// the same per-table statements snapshot() uses, pay a temp table on top, and
// hand back a set the caller narrows in JS anyway. So it declines for the second
// reason a compiler can: not "I cannot say this" but "saying it buys nothing". A
// `.kind=K` filter narrows like any other pred — parseQuery expands the scope
// to kindPreds, so this sees the presence clauses, never a lone ranking.
let narrows = (preds: Pred[]) => preds.some((p) => p.op != ORDER)

// A keyed read wearing the shape a materialized graph hands out: kind is
// derived, num rides the spine, and a caller must not be able to tell which
// door read the row.
export let rowed = (
  { eid, comps }: {
    eid: string
    comps: Record<string, Record<string, unknown>>
  },
): Row => {
  let session = sessionOf(comps)
  if (session) comps.session = session
  return {
    eid,
    num: Number(comps.entity?.num ?? 0),
    kind: kindOf(comps),
    comps,
  }
}

// A scoped Row[] for a KNOWN set of ids — the shape a change-builder
// (spawnChanges, memoryChanges, spawnPlan, …) reads through find(all, id). A
// caller that knows WHICH entities a builder will touch reads just those, keyed
// off the live db, instead of materializing the whole graph to hand a builder a
// set it looks three entities up in (M-21143 — the banned snapshot). locate()
// maps a human id / num / uuid / slug / alias to its eid, eager() reads its
// comps, and rowed() shapes it exactly as a materialized graph would; a null id
// or a miss drops out, as find() over a full graph would return undefined too.
// Deduped by eid so two spellings of the same entity yield one row.
export let rowsFor = (
  db: DatabaseSync,
  ids: (string | null | undefined)[],
): Row[] => {
  let eids = new Set<string>()
  for (let id of ids) {
    if (!id) continue
    let eid = locate(db, id)
    if (eid) eids.add(eid)
  }
  return [...eids].map((eid) => rowed({ eid, comps: eager(db, eid) }))
}

// The default page for the lazy entry partition — a bound on how many entries
// one query returns, since a session's log grows without ceiling. Paging walks
// it by `after` (an entry.seq cursor).
export let ENTRY_PAGE = 500

// The candidate entries a lazy query's JS fallback must see — the partition the
// root snapshot omits, so the matcher can screen them like any eager row. A
// `.entry.session=` scope reads each session's page (entriesOf, keyed +
// bounded); an unscoped lazy query (a lazy pred the index declined) scans the
// partition globally under the same cap.
let entryUniverse = (
  db: DatabaseSync,
  preds: Pred[],
  after: number,
  limit: number,
): Row[] => {
  let sessions = scopedSessions(preds)
  let got = sessions.length
    ? sessions.flatMap((s) => entriesOf(db, s, after, limit))
    : entriesScan(db, after, limit)
  return got.map((e) => rowed({ eid: e.eid, comps: e.comps }))
}

// Entry hits ordered as the partition IS: by session, then the server seq the
// runner stamped. Eager hits answer in num order; entries carry no num, so seq
// is their order. The same `after`/`limit` page every entry door speaks.
let orderedEntries = (hits: Row[], after: number, limit: number): Row[] =>
  hits
    .filter((r) => Number(r.comps.entry?.seq ?? 0) > after)
    .sort((a, b) =>
      String(a.comps.entry!.session).localeCompare(
        String(b.comps.entry!.session),
      ) || Number(a.comps.entry!.seq) - Number(b.comps.entry!.seq)
    )
    .slice(0, limit)

// The index's answer, or null when it declines (the caller falls back to
// evalQuery). Entries ride the index too — matching() walks the whole db — so
// the only question is whether they belong in THIS answer: yes when the query
// names the lazy partition, or a subscription forces it. Otherwise the eager
// partition is the complete scope and entries stay out.
export let evalFast = (
  db: DatabaseSync,
  q: string,
  forceEntries = false,
) => {
  let preds = resolveRefs(parseQuery(q), (id) => locate(db, id))
  if (!narrows(preds)) return null
  let built = where(preds)
  if (!built) return null
  let entries = forceEntries || namesLazy(preds)
  return {
    preds,
    entries,
    hits: matching(db, built).map(rowed)
      .filter((r) => entries || !r.comps.entry)
      .filter((r) => listed(r.comps, preds)),
  }
}

// The scoped fallback for a query the index cannot answer WHOLE — a declining
// predicate, or a hot ranking. It no longer materializes the graph: whereSome()
// compiles the compilable SUBSET of the conjunction (dropping a pred only WIDENS
// an AND-query), matching() reads just the rows that subset selects through the
// index, and the JS matcher refines them with the FULL pred list. Path derefs
// and reverse hops read keyed off the live db on demand (`ent`/`kids`), so a
// candidate set narrower than the whole graph still answers a `.assignee.title`
// or `.comments…` hop identically — the same accessors localQuery already uses.
// The snapshot is gone from every query door (M-21143); no request pulls the
// whole graph into memory.
//
// When the query NAMES the lazy entry partition the candidate set gains its
// entries (matching() omits them the way snapshot did, so entryUniverse adds
// them back, keyed + bounded). `ent` rides out for whoever ranks on top (hot).
export let evalQuery = (
  db: DatabaseSync,
  q: string,
  after = 0,
  limit = ENTRY_PAGE,
) => {
  let preds = resolveRefs(parseQuery(q), (id) => locate(db, id))
  let entries = namesLazy(preds)
  let ent = (e: string) => eager(db, e)
  // A reverse hop reads the children pointing back at each row, keyed off the
  // live db — the same reverse walk localQuery does — so a `.comments…` hop
  // answers identically over a narrowed candidate set as over the whole graph.
  let kids = (eid: string, comp: string, prop: string) =>
    referrersOf(db, [eid], { comp, prop }).map(ent)
  let all = matching(db, whereSome(preds)).map(rowed)
    // matching() reads every entity the subset selects, entry-partition rows
    // included (they keep a spine); snapshot() omitted ALL of them, so drop them
    // here too. entryUniverse is the one bounded entry source — keyed per
    // session or a capped scan — so keeping matching()'s entries would double
    // every one it also returns (and unbound the scan whereSome couldn't).
    .filter((r) => !r.comps.entry)
  if (entries) {
    all = [...all, ...entryUniverse(db, preds, after, limit)]
  }
  let hits = all.filter((r) =>
    listed(r.comps, preds) &&
    matchQuery(r.comps, preds, ent, undefined, kids)
  )
  return { preds, hits, ent }
}

// The aggregate answer — a query carrying `.distinct=col` / `.tally=col`
// reduced server-side. SQL when the column and every filter beside it compile
// (aggregateSql: one indexed statement, never a row set in JS); otherwise the
// JS matcher's rows tallied — the same universe either way, since matchQuery
// passes the AGG pred through. Null for a query with no aggregate projection,
// so a door asks this first and falls through to membership unchanged.
export let evalAgg = (
  db: DatabaseSync,
  q: string,
): { op: 'distinct' | 'tally'; values: Map<string, number> } | null => {
  let preds = resolveRefs(parseQuery(q), (id) => locate(db, id))
  let agg = aggOf(preds)
  if (!agg) return null
  let sql = aggregateSql(preds)
  if (sql) {
    let rows = db.prepare(sql.sql).all(...sql.params) as {
      value: string
      n?: number
    }[]
    return {
      op: agg.op,
      values: new Map(rows.map((r) => [String(r.value), Number(r.n ?? 1)])),
    }
  }
  let { hits } = evalQuery(db, q)
  return { op: agg.op, values: tally(hits.map((h) => h.comps), agg.at) }
}

// The authoritative filter-query answer. The index answers when it can (evalFast
// over matching(), entries included); otherwise the JS matcher over the full
// universe. Hot ranking and entry ordering/paging settle here, so every caller
// reads one answer. Kind is no longer a parameter — `.kind=K` is an ordinary
// pred inside q (query.ts scopes), so it screens through the same seam as
// `.status`.
export let evalGraph = (
  db: DatabaseSync,
  q: string,
  opts: { after?: number; limit?: number } = {},
): { preds: Pred[]; hits: Row[] } => {
  let after = opts.after ?? 0
  let limit = opts.limit ?? ENTRY_PAGE
  let fast = evalFast(db, q)
  if (fast && orderOf(fast.preds) != 'hot') {
    return {
      preds: fast.preds,
      hits: fast.entries
        ? orderedEntries(fast.hits, after, limit)
        : fast.hits.sort((a, b) => a.num - b.num),
    }
  }
  let { preds, ent, hits } = evalQuery(db, q, after, limit)
  let now = Date.now()
  if (orderOf(preds) == 'hot') {
    hits = hits.sort((a, b) =>
      warm(b.comps, now, ent) - warm(a.comps, now, ent)
    )
  } else if (namesLazy(preds)) hits = orderedEntries(hits, after, limit)
  return { preds, hits }
}

// The DEFINING sets a working-set boot seeds — the canvas chrome and the nav's
// own queries (a serverQuery client subscribes to exactly these on mount, and a
// board/card streams the rest). Each is bounded by a chrome-sized kind (canvases,
// projects, this client's UI state), never the graph. `.session!` is DELIBERATELY
// absent: sessions are the one unbounded kind (thousands, ~86% of a naive working
// set) and no boot-time chrome reads them — the Dashboard/Usage views open their
// own `.session!` sub on mount, so sessions stream when a view that needs them
// opens, not at every boot.
export let WS_SETS = [
  '.canvas!',
  '.pin!',
  '.card!',
  '.project!',
  '.favorite!',
  '.cursor!',
  '.camera!',
  '.fold!',
  '.shelf!',
  '.client!',
]

// The working-set boot (M-21143 / T-18059): a joining serverQuery client seeds
// the DEFINING sets it will subscribe to plus the entities its cards point at,
// and ALL edges (allDeps) — NOT the long tail (old tasks, entries, memories,
// comments, mail: the bulk of a whole-graph snapshot), which streams as views
// mount. Same Snapshot shape as snapshot(), so the client's seedFrom seeds it
// unchanged — a PARTIAL cache by construction, kept complete for membership by
// the server subscriptions queryEids opens. queryEids resolving server-side
// (T-17126) and subs bounded to defining queries (T-21283) are what make this
// safe. A cold boot serves this instead of the 44MB whole-graph snapshot() —
// measured 1.62MB vs 42MB on a live-size copy, a 96% cut in the per-connect cost
// that starved the event loop.
export let workingSet = (db: DatabaseSync): Snapshot => {
  let ids = new Set<string>()
  for (let q of WS_SETS) for (let r of evalGraph(db, q).hits) ids.add(r.eid)
  // The entities the cards point at — one hop, so a pinned card paints.
  for (let eid of [...ids]) {
    let t = eager(db, eid).card?.target as string | undefined
    if (t) ids.add(t)
  }
  let changes: Change[] = []
  for (let eid of ids) {
    for (let [name, comp] of Object.entries(eager(db, eid))) {
      changes.push({ eid, name, comp: comp as Change['comp'] })
    }
  }
  return {
    changes,
    deps: allDeps(db),
    cursor: cursorOf(db),
    epoch: epochOf(db),
    vocabHash,
    capabilities,
  }
}

// The /query door as a Querier bound to a db — the same id=+evalGraph
// resolution the HTTP route runs, minus the backlinks/deps/paging presentation
// a client.ts enumeration never asks for. This is what lets a server route
// drive readerRows/inboxFor against the LIVE graph with no HTTP round-trip and
// ONE query semantics (T-18105): the inbox predicate stays in client.ts, and
// only its answerer swaps. `id=` FETCHES by address (locate: T-3, num, slug,
// uuid) then screens by any remaining filter — quarantine included, the same as
// the route's id path; everything else runs evalGraph.
export let localQuery = (db: DatabaseSync): Querier =>
// deno-lint-ignore require-await
async (filters, opts) => {
  let named = filters.filter((s) => s.startsWith('id='))
    .flatMap((s) => s.slice(3).split(',')).filter(Boolean)
  let q = filters.filter((s) => !s.startsWith('id=')).join('&')
  if (!named.length) return evalGraph(db, q, opts).hits
  // A tombstoned entity still resolves by name but has left the graph, and its
  // spine row now survives the delete (D-18866) — exclude it so `id=` addresses
  // live entities only, matching the /query door and snapshot().
  let only = (named.map((i) => locate(db, i)).filter(Boolean) as string[])
    .filter((eid) => !buried(db, eid))
  let preds = resolveRefs(parseQuery(q), (id) => locate(db, id))
  let read = (e: string) => eager(db, e)
  let kids = (eid: string, comp: string, prop: string) =>
    referrersOf(db, [eid], { comp, prop }).map(read)
  return only.map((eid) => rowed({ eid, comps: eager(db, eid) }))
    .filter((r) =>
      listed(r.comps, preds) &&
      matchQuery(r.comps, preds, read, undefined, kids)
    )
}

// The bounded persona subgraph a spawn or a role materializes — exactly the
// rows+deps materialize()/wornPersona()/commonOf() walk, gathered by keyed
// reads instead of the whole-graph snapshot (M-21143). BFS from `roots` (a
// persona, an explicit --persona, the global base, or a project whose common
// persona is the one it `contains`): each node is eager()-read so its
// doc/persona/memory/recall comps ride out exactly as snapshot() served them,
// and its OUTGOING contains/reads edges (depsOf) enqueue the tier members —
// through sub-personas to any depth. The persona functions stay pure over
// rows+deps; this only supplies a narrower universe than the whole graph, and
// an unreachable edge or memory that never enters the walk could not have
// changed the rendered text (a tier names only what it can reach from its root).
export let personaGraph = (
  db: DatabaseSync,
  roots: string[],
): { all: Row[]; deps: Dep[] } => {
  let all = new Map<string, Row>()
  let deps: Dep[] = []
  let seenDep = new Set<string>()
  let seen = new Set<string>()
  let queue = roots.filter(Boolean)
  while (queue.length) {
    let eid = queue.shift()!
    if (seen.has(eid)) continue
    seen.add(eid)
    let comps = eager(db, eid)
    if (!comps.entity) continue
    all.set(eid, rowed({ eid, comps }))
    for (let d of depsOf(db, [eid])) {
      if (d.parent != eid) continue // only edges OUT of this node drive the walk
      if (d.type != 'contains' && d.type != 'reads') continue
      let key = `${d.parent}\0${d.type}\0${d.child}`
      if (!seenDep.has(key)) {
        seenDep.add(key)
        deps.push(d)
      }
      queue.push(d.child)
    }
  }
  return { all: [...all.values()], deps }
}

// The colon-command executor's graph access, keyed off the live db — the
// db-backed twin of commands.ts rowsReader (M-21143: the executor never rides a
// whole-graph snapshot). Every method is a SCOPED read: an id resolves through
// locate()+eager(), a kind enumeration through evalGraph(), a dependents walk
// through referrersOf(), persona ownership through depsOf(). `overlay` carries
// rows a command minted but hasn't applied yet — a filed page, a spec-line
// task — so the verb that names them resolves them before the batch lands, the
// way `rows({changes:[…snap, …out]})` used to overlay them on the snapshot.
export let dbReader = (db: DatabaseSync, overlay: Row[] = []): Reader => {
  let read = (eid: string): Row | undefined => {
    let comps = eager(db, eid)
    return comps.entity ? rowed({ eid, comps }) : undefined
  }
  let g: Reader = {
    find: (id) => {
      let pending = find(overlay, id)
      if (pending) return pending
      let eid = locate(db, id)
      // A tombstoned entity resolves by name but has left the graph — the
      // snapshot the rows reader read excluded it, so exclude it here too.
      return !eid || buried(db, eid) ? undefined : read(eid)
    },
    // The scoped reader declines a whole-graph "did you mean?" scan; the miss
    // still names the id and the door it was said at, as need() always has.
    need: (id, where, comp) => g.find(id) ?? need([], id, where, comp),
    session: (sid) =>
      evalGraph(db, `.session.id=${sid}`).hits.find(
        (r) => String(r.comps.session?.id) == sid,
      ),
    cascade: (eid) => {
      let aimed = deaths('cascade')
      let found = new Map<string, Row>()
      let frontier = [eid]
      while (frontier.length) {
        let next: string[] = []
        for (let d of frontier) {
          for (let [comp, prop] of aimed) {
            for (let e of referrersOf(db, [d], { comp, prop })) {
              if (e == eid || found.has(e)) continue
              let row = read(e)
              if (row) found.set(e, row)
              next.push(e)
            }
          }
        }
        frontier = next
      }
      return [...found.values()]
    },
    select: (filter) => evalGraph(db, filter).hits,
    deps: (eids) => depsOf(db, eids),
  }
  return g
}
