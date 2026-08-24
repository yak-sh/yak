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
import { type Dep, kindOf, sessionOf } from './types.ts'
import { type Querier, type Row } from './client.ts'
import {
  buried,
  depsOf,
  eager,
  entriesOf,
  entriesScan,
  locate,
  matching,
  referrersOf,
} from './db.ts'
import { where, whereSome } from './sql.ts'
import {
  listed,
  matchQuery,
  namesLazy,
  ORDER,
  orderOf,
  parseQuery,
  type Pred,
  resolveRefs,
  scopedSessions,
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
