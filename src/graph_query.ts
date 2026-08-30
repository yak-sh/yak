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
  kindOf,
  sessionActive,
  sessionOf,
  type Snapshot,
  statusOf,
} from './types.ts'
import {
  find,
  idOf,
  need,
  type Querier,
  type Row,
  WORK_REFS_LIMIT,
  type WorkProjection,
} from './client.ts'
import type { Reader } from './commands.ts'
import {
  buried,
  cursorOf,
  depsOf,
  eager,
  entriesOf,
  entriesScan,
  epochOf,
  human,
  locate,
  matching,
  reaching,
  referrersOf,
  search,
  textMatches,
  vocabHash,
} from './db.ts'
import { aggregateSql, countSql, where, whereSome, windowed } from './sql.ts'
import { hasSources } from './source.ts'
import {
  AGG,
  aggOf,
  EDGES,
  listed,
  matchQuery,
  namesLazy,
  ORDER,
  orderOf,
  parseQuery,
  type Pred,
  PROJECT,
  REACHES,
  resolveRefs,
  screened,
  tally,
  TEXT,
  type Walk,
  warm,
  type Win,
  WINDOW,
  windowOf,
} from './query.ts'
import { inputsOf, resultsOf, withResults } from './result_component.ts'
import {
  workAuthorizationSql,
  workLineageSql,
  workPredicates,
  workReadyJoinsSql,
  workReadyWhereSql,
  workRootsSql,
} from './work.ts'
import {
  verificationArgs,
  verificationReviewOrder,
  verificationReviewWhere,
  VERIFY_PENDING,
} from './verification.ts'
export { personaGraph, projectionGraph } from './persona_graph.ts'

// A filter of only rankings — or of nothing at all — selects EVERY entity, and
// there the index has nothing to offer: matching() would read every row through
// the same per-table statements snapshot() uses, pay a temp table on top, and
// hand back a set the caller narrows in JS anyway. So it declines for the second
// reason a compiler can: not "I cannot say this" but "saying it buys nothing". A
// `.kind=K` filter narrows like any other pred — parseQuery expands the scope
// to kindPreds, so this sees the presence clauses, never a lone ranking.
// The EDGES rider joins ORDER here for the same reason: `.edges!` asks for a
// DELIVERY beside the answer, it never narrows one, so a query wearing only
// riders has said nothing about membership and the index has nothing to offer.
let narrows = (preds: Pred[]) =>
  preds.some((p) => p.op != ORDER && p.op != EDGES)

// A traversal accessor bound to a db, memoised for ONE evaluation pass: the
// closure `.reaches[requires,<=3]=T-42` names is the same for every candidate
// row, so it is resolved once (one recursive CTE, db.ts reaching) and every row
// then tests it with a Set lookup. Built per call so nothing caches a closure
// across writes — an edge landing between two queries must move the answer.
export let walker = (db: DatabaseSync): Walk => {
  let memo = new Map<string, Set<string>>()
  return (r, target) => {
    let key = `${r.type}\0${r.depth}\0${target}`
    let hit = memo.get(key)
    if (!hit) {
      memo.set(key, hit = new Set(reaching(db, target, r.type, r.depth)))
    }
    return hit
  }
}

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
  // The DERIVED task.status (D-24102): materialize it onto the read shape so
  // every server reader — a projection's JS fallback, an edge-peer, a sort — sees
  // the computed value a stored column once carried, without re-deriving. The
  // write path never passes through here, so nothing storable is invented; the
  // task comp is copied so a shared/cached bag is never mutated.
  if (comps.task) comps.task = { ...comps.task, status: statusOf(comps) }
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

// The storage doors used to select a query's candidate partition. Kept as an
// explicit seam so a test can prove partition selection happens BEFORE either
// universe is enumerated; it also makes the invariant visible in the evaluator
// rather than relying on a particular SQL string continuing to compile.
export type QueryUniverseDoors = {
  matching: typeof matching
  entriesOf: typeof entriesOf
  entriesScan: typeof entriesScan
}
let universeDoors: QueryUniverseDoors = { matching, entriesOf, entriesScan }

// The candidate entries a lazy query must see — the partition the root
// snapshot omits, so the matcher can screen them like any eager row. A
// `.entry.session=` scope reads directly through entriesOf (keyed + bounded);
// an unscoped lazy query scans the partition globally under the same cap.
//
// An entry cursor is `seq`, which is only unique inside one Session. A scalar
// equality can therefore take the keyed door; an unscoped/range query can read
// one bounded prefix, but cannot continue it with `after`. A multi-session
// equality is refused rather than returning a first page whose cursor would
// duplicate or skip rows on the next page.
let entryScope = (preds: Pred[]): string | null | undefined => {
  let narrowed: Set<string> | undefined
  for (let p of preds) {
    if (p.comp != 'entry' || p.prop != 'session' || p.op != '') continue
    if (p.value.includes('..')) continue
    let values = new Set(p.value.split(',').filter(Boolean))
    narrowed = narrowed == null
      ? values
      : new Set([...narrowed].filter((value) => values.has(value)))
  }
  if (narrowed == null) return undefined
  if (!narrowed.size) return null
  if (narrowed.size > 1) {
    throw new Error(
      'entry pages require one scalar .entry.session= value; query each Session separately',
    )
  }
  return [...narrowed][0]
}

export let entryUniverse = (
  db: DatabaseSync,
  preds: Pred[],
  after: number,
  limit: number,
  doors: QueryUniverseDoors = universeDoors,
): Row[] => {
  if (limit <= 0) return []
  let session = entryScope(preds)
  if (session === undefined && after > 0) {
    throw new Error(
      'entry .after cursor requires one scalar .entry.session= value',
    )
  }
  let got = session === null
    ? []
    : session === undefined
    ? doors.entriesScan(db, after, limit)
    : doors.entriesOf(db, session, after, limit)
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

// A caller's window over the line's own: an explicit argument wins, so the
// /query door's paging still bounds a query whose text names no window.
export let merged = (a: Win, b?: Win): Win => {
  let after = b?.after ?? a.after
  return {
    limit: b?.limit ?? a.limit,
    // A cursor of ZERO is no cursor. Nums and entry seqs both start at 1, and
    // every door that pages has always spelled "from the start" as `after ?? 0`
    // — so reading a literal 0 as a bound would answer the empty set to callers
    // that have passed it for years.
    after: after || undefined,
  }
}

// How many entities a filter selects, from the index. `undefined` when no
// statement can say it: a declining predicate, or a registered SOURCE, whose
// pass-through entities join the answer AFTER the statement (matching()) and so
// are invisible to a count. A total nobody can vouch for is not stated.
let countOf = (db: DatabaseSync, preds: Pred[]): number | undefined => {
  if (hasSources()) return undefined
  let sql = countSql(preds)
  if (!sql) return undefined
  let row = db.prepare(sql.sql).get(...sql.params) as { n?: number } | undefined
  return Number(row?.n ?? 0)
}

// The index's answer, or null when it declines (the caller falls back to
// evalQuery). Entries ride the index too — matching() walks the whole db — so
// the only question is whether they belong in THIS answer: yes when the query
// names the lazy partition, or a subscription forces it. Otherwise the eager
// partition is the complete scope and entries stay out.
export let evalFast = (
  db: DatabaseSync,
  q: string,
  forceEntries = false,
  w?: Win,
) => {
  let preds = resolveRefs(parseQuery(q), (id) => locate(db, id))
  let inputs = inputsOf(preds)
  if (!narrows(inputs)) return null
  let entries = forceEntries || namesLazy(preds)
  // Lazy membership is selected from its storage partition before hydration.
  // Even a fully compilable lazy predicate must not take matching(): its SQL
  // answer is unwindowed here because entries page by seq downstream, which
  // used to hydrate the session's entire history and discard all but 500.
  // evalQuery applies the same predicates/projections to the bounded lazy door.
  if (entries) return null
  // The statement carries the screens the JS filters below otherwise apply
  // AFTER it (query.ts screened) — which is the whole reason a LIMIT may ride
  // it: a filter that runs after the limit under-fills the page. The JS filters
  // stay for the rows matching() unions in from a SOURCE, which no statement saw.
  let built = where(screened(inputs, entries))
  if (!built) return null
  let win = merged(windowOf(preds), w)
  // Entries page by their own seq (orderedEntries), never by spine num, so a
  // lazy answer stays whole here and is windowed downstream.
  let bounded = !entries && (win.limit != null || win.after != null)
  let hits = matching(db, bounded ? windowed(built, win) : built).map(rowed)
    .filter((r) => entries || !r.comps.entry)
  hits = withResults(db, preds, hits)
    .filter((r) => listed(r.comps, preds))
  if (resultsOf(preds).length) {
    hits = hits.filter((r) => matchQuery(r.comps, preds))
  }
  return {
    preds,
    entries,
    win,
    hits,
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
  doors: QueryUniverseDoors = universeDoors,
) => {
  let preds = resolveRefs(parseQuery(q), (id) => locate(db, id))
  let inputs = inputsOf(preds)
  let entries = namesLazy(preds)
  let ent = (e: string) => eager(db, e)
  // A reverse hop reads the children pointing back at each row, keyed off the
  // live db — the same reverse walk localQuery does — so a `.comments…` hop
  // answers identically over a narrowed candidate set as over the whole graph.
  let kids = (eid: string, comp: string, prop: string) =>
    referrersOf(db, [eid], { comp, prop }).map(ent)
  let walk = walker(db)
  let fts = (eid: string, p: Pred) => textMatches(db, eid, p)
  // Select the relevant storage partition BEFORE hydration. Naming a positive
  // session-log facet can only match lazy entries, so enumerating the eager /
  // source-list universe first is both wasted and dangerous: matching() also
  // sees entry spines and can hydrate an unbounded history. Conversely an eager
  // query never opens the lazy door. There is one branch, at the universe
  // boundary, for every lazy predicate — not a query-string special case.
  let all = entries
    ? entryUniverse(db, preds, after, limit, doors)
    : doors.matching(db, whereSome(inputs)).map(rowed)
      // matching() may union source rows wearing entry; eager queries do not
      // opt into that partition.
      .filter((r) => !r.comps.entry)
  all = withResults(db, preds, all)
  let hits = all.filter((r) =>
    listed(r.comps, preds) &&
    matchQuery(r.comps, preds, ent, undefined, kids, walk, fts)
  )
  return { preds, hits, ent }
}

// A subscription whose filter the index cannot answer WHOLE gets a BOUNDED
// newest-first answer instead of whereSome's full candidate scan. On the live
// graph the scan stages every eager entity (~21k) and refines in JS — 5s of
// blocked event loop for a time-window board, 45s+ for a hot ranking, on
// EVERY card mount — while a board renders a page, never the tail. Candidates
// come off the spine newest-first (entries excluded in SQL: their spines
// dominate the high nums and would eat the whole budget before refinement),
// read at 2× the cap so a moderately-selective refinement still fills it, then
// the same listed+matchQuery refinement evalQuery runs. The contract shift is
// deliberate and documented at the door: a declining sub's initial answer is a
// newest-first PREFIX of its matches; deltas keep it live from there, and the
// HTTP /query door still pages the exact, complete answer.
export let SUB_CAP = 1000
export let evalCapped = (
  db: DatabaseSync,
  q: string,
  cap = SUB_CAP,
  after?: number,
) => {
  let preds = resolveRefs(parseQuery(q), (id) => locate(db, id))
  let inputs = inputsOf(preds)
  let ent = (e: string) => eager(db, e)
  let kids = (eid: string, comp: string, prop: string) =>
    referrersOf(db, [eid], { comp, prop }).map(ent)
  // The entry and quarantine screens ride the compiled preds like any filter
  // (query.ts screened), so the candidate window is spent on rows that can
  // actually match rather than on entry spines the JS pass drops afterwards.
  let room = cap * 2
  let base = windowed(whereSome(screened(inputs, false)), {
    limit: room,
    after,
  })
  // matching() reads the hit table in its own order — re-rank by num so the
  // slice keeps the NEWEST matches, not an arbitrary cap-full.
  let walk = walker(db)
  let fts = (eid: string, p: Pred) => textMatches(db, eid, p)
  let raw = withResults(db, preds, matching(db, base).map(rowed))
  let hits = raw
    .filter((r) =>
      listed(r.comps, preds) &&
      matchQuery(r.comps, preds, ent, undefined, kids, walk, fts)
    )
    .sort((a, b) => b.num - a.num)
  // A candidate read that came back SHORT of its own bound saw the whole
  // superset, and refining a complete superset is a complete answer — which is
  // how a declining query can still know it is not holding a prefix.
  let whole = raw.length < room && hits.length <= cap
  return { preds, hits: hits.slice(0, cap), whole }
}

// The MEMBERSHIP answerer control() calls: exact when the index answers whole
// (evalFast), exact when the sub NEEDS the whole universe (an entries partition,
// a lazy-naming query), bounded newest-first otherwise. A subscribe never
// full-scans the graph on a socket's clock.
//
// An AGGREGATE sub never arrives here at all — it answers a value, so control()
// sends it to evalAgg and no row set is ever built. The aggregate branch below
// remains for a caller that asks evalSub an aggregate line directly: a capped
// tally would undercount every badge, so it must stay exact.
// What a subscription's initial frame carries. `window` is present exactly when
// the members are a PREFIX of the query's matches — the client is told the bound
// it holds and, when an index can vouch for it, the total it is a prefix of. An
// answer that is whole carries no window at all, so an unwindowed sub's frame
// semantics are untouched.
export type SubAnswer = {
  preds: Pred[]
  hits: Row[]
  window?: { limit: number; total?: number }
  // Whether the INDEX answered this whole — no JS refinement over a candidate
  // scan. Only an exact window is cheap enough to RE-ANSWER on every dirtying
  // batch, which is what a windowed sub does to stay right at its edge; a
  // declining one keeps the per-eid maintenance it has always had.
  exact?: boolean
}

export let evalSub = (
  db: DatabaseSync,
  q: string,
  details = false,
  cap = SUB_CAP,
): SubAnswer => {
  let asked = resolveRefs(parseQuery(q), (id) => locate(db, id))
  // A sub that NEEDS the whole universe never windows: entries page by their
  // own seq, and a capped tally would undercount every badge.
  if (details || namesLazy(asked) || aggOf(asked)) {
    let { preds, hits } = evalQuery(db, q)
    return { preds, hits }
  }
  let win = windowOf(asked)
  // Every row sub is bounded. `.limit=` is a client saying a smaller window is
  // all it wants; SUB_CAP is the server's floor under the ones that say nothing,
  // so no single socket can stage the graph. Both are the same stated form.
  let limit = win.limit ?? cap
  // Read ONE past the bound: that single extra row tells a whole answer from a
  // prefix without paying a count for every subscription in the fleet.
  let fast = evalFast(db, q, false, { limit: limit + 1, after: win.after })
  if (fast) {
    let hits = fast.hits.sort((a, b) => b.num - a.num)
    // Whole, and nobody asked for a window: the frame says nothing about bounds
    // because there is nothing to say.
    if (hits.length <= limit && win.limit == null) {
      return { preds: fast.preds, hits, exact: true }
    }
    let over = hits.length > limit
    return {
      preds: fast.preds,
      hits: hits.slice(0, limit),
      exact: true,
      window: {
        limit,
        total: over
          ? countOf(db, screened(inputsOf(fast.preds), false))
          : hits.length,
      },
    }
  }
  // The filter declines, so the answer is a candidate prefix the JS matcher
  // refined and no statement can total. Saying the bound and leaving the total
  // unstated is the honest frame: the client knows it holds a window, and knows
  // nobody counted the rest.
  let capped = evalCapped(db, q, limit, win.after)
  return capped.whole && win.limit == null
    ? { preds: capped.preds, hits: capped.hits }
    : { preds: capped.preds, hits: capped.hits, window: { limit } }
}

// The aggregate answer — a query carrying `.count!`, `.distinct=col` or
// `.tally=col` reduced server-side. SQL when the column and every filter beside
// it compile (aggregateSql: one indexed statement, never a row set in JS);
// otherwise the JS matcher's rows reduced — the same universe either way, since
// matchQuery passes the AGG pred through. Null for a query with no aggregate
// projection, so a door asks this first and falls through to membership
// unchanged.
//
// Every shape answers as one value→count map: `count` uses the empty key, which
// no tally can collide with (tally drops empties, exactly as the census does).
export let evalAgg = (
  db: DatabaseSync,
  q: string,
):
  | { op: 'distinct' | 'tally' | 'count'; values: Map<string, number> }
  | null => {
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
  return {
    op: agg.op,
    values: agg.op == 'count'
      ? new Map([['', hits.length]])
      : tally(hits.map((h) => h.comps), agg.at),
  }
}

// The build lane is a derived selection, not a status. Its recursive CTE walks
// from the scoped candidate set toward approved ancestors, so a query never
// enumerates the graph (or every approved task) to discover authorization.
// UNION terminates cycles; inner joins make an unknown endpoint a hard stop;
// and pending/declined rows are admitted as boundaries but never expanded.
// Readiness is screened before ORDER/LIMIT, making the returned prefix exactly
// priority ASC, newest spine first rather than a re-ranked recent sample.
let workBase = (db: DatabaseSync, q: string) => {
  let preds = workPredicates(
    resolveRefs(parseQuery(q), (id) => locate(db, id)),
  )
  if (
    preds.some((p) =>
      p.rev || p.refs || p.reach ||
      [AGG, EDGES, ORDER, PROJECT, REACHES, TEXT, WINDOW].includes(p.op)
    )
  ) {
    throw new Error(
      'work filters support indexed scalar dot-params and forward reference ' +
        'paths only; text, reverse hops, traversals, windows, rankings, and ' +
        'projections are unsupported',
    )
  }
  // Unlike an ordinary graph query, work has no reveal mode. These outer
  // screens are unconditional even if a future predicate classifier changes:
  // candidates are visible eager entities before readiness or LIMIT runs.
  let base = where([
    ...inputsOf(preds),
    { comp: 'quarantined', prop: '', op: '', value: '' },
    { comp: 'entry', prop: '', op: '', value: '' },
  ])
  if (!base) {
    throw new Error(
      'work filter cannot be answered exactly by indexed SQL; use a scalar ' +
        'equality, list, range, comparison, presence, or absence predicate',
    )
  }
  return base
}

let workSelectionSql = (
  db: DatabaseSync,
  q: string,
  opts: {
    limit: number | null
    recursive?: boolean
    order: 'worker' | 'dispatch'
  },
) => {
  let base = workBase(db, q)
  let lineage = opts.recursive
    ? `, ${workLineageSql('candidate')}, ${workRootsSql}`
    : ''
  let authorization = workAuthorizationSql(!!opts.recursive)
  let dispatch = opts.order == 'dispatch'
  let ordering = dispatch
    ? `resume.entity is null, resume.rank desc,
       task.priority is null, task.priority asc,
       created.at is null, created.at asc, entity.num asc`
    : `task.priority is null, task.priority asc, entity.num desc`
  return {
    sql: `with recursive filtered(eid) as materialized (${base.sql}),
       candidate(origin, entity) as materialized (
         select entity.id, entity.id from filtered
         join entity on entity.eid = filtered.eid
       )${lineage}
       select entity.eid as eid
         from candidate
       join entity on entity.id = candidate.entity
       ${workReadyJoinsSql}
         ${
      dispatch
        ? `left join created on created.entity = entity.id
         left join resume on resume.entity = entity.id`
        : ''
    }
        where ${workReadyWhereSql(authorization)}
        order by ${ordering}${opts.limit == null ? '' : '\n        limit ?'}`,
    params: [...base.params, ...(opts.limit == null ? [] : [opts.limit])],
  }
}

export let buildWorkSql = (
  db: DatabaseSync,
  q: string,
  opts: { limit?: number; recursive?: boolean } = {},
) =>
  workSelectionSql(db, q, {
    limit: Math.max(1, Math.min(opts.limit ?? 20, 100)),
    recursive: opts.recursive,
    order: 'worker',
  })

export let evalBuildWork = (
  db: DatabaseSync,
  q: string,
  opts: { limit?: number; recursive?: boolean } = {},
): Row[] => {
  let built = buildWorkSql(db, q, opts)
  let ids = db.prepare(built.sql).all(...built.params) as { eid: string }[]
  let by = new Map(rowsFor(db, ids.map((r) => r.eid)).map((r) => [r.eid, r]))
  return ids.map((r) => by.get(r.eid)).filter((r): r is Row => !!r)
}

// Managed dispatch consumes the SAME complete membership CTE as external
// workers, but keeps its established spend order: resumed generation/rank,
// then priority, oldest creation, and number. It is intentionally unwindowed — asked/provider policy is
// applied afterward and may skip any prefix, so a limit here would make an
// eligible tail disappear.
export let evalDispatchWork = (
  db: DatabaseSync,
  q: string,
  recursive = false,
): Row[] => {
  let built = workSelectionSql(db, q, {
    limit: null,
    recursive,
    order: 'dispatch',
  })
  let ids = db.prepare(built.sql).all(...built.params) as { eid: string }[]
  let by = new Map(rowsFor(db, ids.map((r) => r.eid)).map((r) => [r.eid, r]))
  return ids.map((r) => by.get(r.eid)).filter((r): r is Row => !!r)
}

// Verification is ordered by the fact workers are reviewing, not task
// creation or priority. The completed_at index owns the walk, every optional
// caller filter is screened in the materialized candidate set, and the
// authoritative policy is applied before LIMIT.
export let verifyWorkSql = (
  db: DatabaseSync,
  q: string,
  opts: { limit?: number } = {},
) => {
  let base = workBase(db, q)
  let limit = Math.max(1, Math.min(opts.limit ?? 20, 100))
  return {
    sql: `with filtered(eid) as materialized (${base.sql})
      select entity.eid as eid
        from completed indexed by completed_at
        join task on task.entity = completed.entity
        join entity on entity.id = task.entity
        join filtered on filtered.eid = entity.eid
       where ${VERIFY_PENDING}
       order by completed.at desc, entity.num desc
       limit ?`,
    params: [...base.params, ...verificationArgs(), limit],
  }
}

export let evalVerifyWork = (
  db: DatabaseSync,
  q: string,
  opts: { limit?: number } = {},
): Row[] => {
  let built = verifyWorkSql(db, q, opts)
  let ids = db.prepare(built.sql).all(...built.params) as { eid: string }[]
  let by = new Map(rowsFor(db, ids.map((r) => r.eid)).map((r) => [r.eid, r]))
  return ids.map((r) => by.get(r.eid)).filter((r): r is Row => !!r)
}

let WORK_TEXT_LIMIT = 4000

type CompletionEvidence = {
  task: string
  at: string | null
  builder: string | null
  body: string
  truncated: number
}

type ReviewEvidence = {
  task: string
  review: string | null
  verdict: 'approved' | 'rejected' | 'changes_requested'
  body: string
  truncated: number
  reviewer: string | null
  at: string
  position: number
}

type VerifierEvidence = {
  task: string
  verifier: string | null
  status: string | null
  at: string
  position: number
}

// Evidence is read only for the already bounded candidate set. Text is cut in
// SQLite, before it enters a row or transport, and every referenced entity is
// screened for quarantine before its human id is formed. The review WHERE and
// ordering are the same fragments VERIFY_PENDING uses.
let workVerifications = (
  db: DatabaseSync,
  candidates: Row[],
) => {
  let ids = [...new Set(candidates.map((r) => r.eid))].slice(0, 100)
  let out = new Map<string, WorkProjection['verification']>()
  if (!ids.length) return out
  let marks = ids.map(() => '?').join(',')
  let completions = db.prepare(
    `select owner.eid as task, completed.at as at,
            case when builder_hidden.entity is null then builder.eid end
              as builder,
            substr(accept.body, 1, ?) as body,
            length(accept.body) > ? as truncated
       from entity owner
       join task on task.entity = owner.id
       join accept on accept.entity = task.entity
       join completed on completed.entity = task.entity
       join session builder_session on builder_session.entity = completed.via
       join entity builder on builder.id = builder_session.entity
       left join quarantined builder_hidden
         on builder_hidden.entity = builder.id
      where owner.eid in (${marks})`,
  ).all(WORK_TEXT_LIMIT, WORK_TEXT_LIMIT, ...ids) as CompletionEvidence[]

  let reviews = db.prepare(
    `with ranked as (
       select owner.eid as task,
              case when review_hidden.entity is null then _ve.eid end
                as review,
              _vr.verdict as verdict,
              substr(_vd.body, 1, ?) as body,
              length(_vd.body) > ? as truncated,
              case when reviewer_hidden.entity is null then reviewer.eid end
                as reviewer,
              _va.at as at,
              row_number() over (
                partition by task.entity
                order by ${verificationReviewOrder}
              ) as position
         from entity owner
         join task on task.entity = owner.id
         join completed _vc on _vc.entity = task.entity
         join comment _vm indexed by comment_target
           on _vm.target = task.entity
         join review _vr on _vr.entity = _vm.entity
         join entity _ve on _ve.id = _vr.entity
         join doc_value _vd on _vd.entity = _vm.entity
         join created _va on _va.entity = _vm.entity
         join session _vs on _vs.entity = _va.via
         join entity reviewer on reviewer.id = _vs.entity
         left join quarantined review_hidden
           on review_hidden.entity = _ve.id
         left join quarantined reviewer_hidden
           on reviewer_hidden.entity = reviewer.id
        where owner.eid in (${marks})
          and ${verificationReviewWhere}
     )
     select * from ranked where position = 1`,
  ).all(WORK_TEXT_LIMIT, WORK_TEXT_LIMIT, ...ids) as ReviewEvidence[]

  let verifiers = db.prepare(
    `with ranked as (
       select owner.eid as task,
              case when verifier_hidden.entity is null then runner.eid end
                as verifier,
              s.status as status, _vz.at as at,
              row_number() over (
                partition by task.entity
                order by _vz.at desc, runner.eid desc
              ) as position
         from entity owner
         join task on task.entity = owner.id
         join completed _vc on _vc.entity = task.entity
         join session s indexed by session_requested_task
           on s.requested_task = task.entity
         join verifier v on v.entity = s.entity
         join created _vz on _vz.entity = s.entity
         join entity runner on runner.id = s.entity
         left join quarantined verifier_hidden
           on verifier_hidden.entity = runner.id
        where owner.eid in (${marks})
          and _vz.at > _vc.at
     )
     select * from ranked where position = 1`,
  ).all(...ids) as VerifierEvidence[]

  let reviewBy = new Map(reviews.map((r) => [r.task, r]))
  let verifierBy = new Map(verifiers.map((r) => [r.task, r]))
  for (let completion of completions) {
    let review = reviewBy.get(completion.task)
    let verifier = verifierBy.get(completion.task)
    out.set(completion.task, {
      accept: {
        body: completion.body,
        truncated: !!completion.truncated,
      },
      completed: {
        at: completion.at,
        via: completion.builder ? human(db, completion.builder) : null,
      },
      ...(review?.review
        ? {
          review: {
            id: human(db, review.review),
            verdict: review.verdict,
            body: review.body,
            truncated: !!review.truncated,
            reviewer: review.reviewer ? human(db, review.reviewer) : null,
            at: review.at,
          },
        }
        : {}),
      ...(verifier?.verifier
        ? {
          verifier: {
            id: human(db, verifier.verifier),
            status: verifier.status,
            at: verifier.at,
            active: verifier.status == null ||
              sessionActive.includes(verifier.status),
          },
        }
        : {}),
    })
  }
  return out
}

// A candidate summary needs names for a bounded number of unresolved direct
// dependencies, not every endpoint on a high-fanout task. The parent and child
// indexes answer this one scoped window per parent; CAP+1 proves truncation,
// and only the CAP rows that will be emitted are hydrated.
export let workBlockers = (
  db: DatabaseSync,
  parents: string[],
  limit = 20,
): { parent: string; items: Row[]; truncated: boolean }[] => {
  let unique = [...new Set(parents)].filter(Boolean).slice(0, 100)
  if (!unique.length) return []
  let cap = Math.max(1, Math.min(limit, 100))
  let marks = unique.map(() => '?').join(',')
  let found = db.prepare(
    `with ranked as (
       select parent.eid as parent, child.eid as child,
              row_number() over (
                partition by dependency.parent
                order by dependency.ord, child.num
              ) as position
         from dependency
         join entity parent on parent.id = dependency.parent
         join entity child on child.id = dependency.child
         left join completed on completed.entity = child.id
         left join cancelled on cancelled.entity = child.id
         left join quarantined on quarantined.entity = child.id
         left join tombstone child_dead on child_dead.eid = child.eid
        where parent.eid in (${marks})
          and dependency.type = 'requires'
          and completed.entity is null
          and cancelled.entity is null
          and quarantined.entity is null
          and child_dead.eid is null
     )
     select parent, child, position from ranked
      where position <= ? order by parent, position`,
  ).all(...unique, cap + 1) as {
    parent: string
    child: string
    position: number
  }[]
  let emitted = found.filter((r) => r.position <= cap)
  let rows = new Map(
    rowsFor(db, emitted.map((r) => r.child)).map((r) => [r.eid, r]),
  )
  return unique.map((parent) => {
    let mine = found.filter((r) => r.parent == parent)
    return {
      parent,
      items: mine.slice(0, cap).flatMap((r) => {
        let row = rows.get(r.child)
        return row ? [row] : []
      }),
      truncated: mine.length > cap,
    }
  })
}

let workAuthorizations = (
  db: DatabaseSync,
  candidates: Row[],
  limit = WORK_REFS_LIMIT,
) => {
  let ids = [...new Set(candidates.map((r) => r.eid))].slice(0, 100)
  let out = new Map<string, { from: string[]; truncated: boolean }>()
  if (!ids.length) return out
  let cap = Math.max(1, Math.min(limit, 100))
  let marks = ids.map(() => '?').join(',')
  let found = db.prepare(
    `with recursive seed(origin, entity) as (
       select id, id from entity where eid in (${marks})
     ), ${
      workLineageSql('seed')
    }, ${workRootsSql}, eligible(origin, root, num) as (
       select lineage.origin, root.entity, root.num
         from lineage
         join approved_root root on root.entity = lineage.entity
     ), ranked as (
       select origin, root,
              row_number() over (partition by origin order by num desc) position
         from eligible
     )
     select source.eid as source, target.eid as target, ranked.position
       from ranked
       join entity source on source.id = ranked.origin
       join entity target on target.id = ranked.root
      where ranked.position <= ? order by source, ranked.position`,
  ).all(...ids, cap + 1) as {
    source: string
    target: string
    position: number
  }[]
  let emitted = found.filter((r) => r.position <= cap)
  let roots = new Map(
    rowsFor(db, emitted.map((r) => r.target)).map((r) => [r.eid, r]),
  )
  for (let candidate of candidates) {
    let mine = found.filter((r) => r.source == candidate.eid)
    out.set(candidate.eid, {
      from: mine.slice(0, cap).flatMap((r) => {
        let root = roots.get(r.target)
        return root ? [idOf(root)] : []
      }),
      truncated: mine.length > cap,
    })
  }
  return out
}

// Every public work lane returns ordinary rows plus one transient `work`
// projection. The projection is assembled beside SQLite in one local read, so
// HTTP, MCP stdio, and an armed CLI share quarantine screening and never walk
// authorization depth over the transport.
export let evalWork = (
  db: DatabaseSync,
  q: string,
  opts: {
    work: 'evaluate' | 'build' | 'verify'
    limit?: number
    recursive?: boolean
  },
): Row[] => {
  let limit = Math.max(1, Math.min(opts.limit ?? 20, 100))
  let hits = opts.work == 'build'
    ? evalBuildWork(db, q, { limit, recursive: opts.recursive })
    : opts.work == 'verify'
    ? evalVerifyWork(db, q, { limit })
    : (() => {
      workBase(db, q)
      return evalGraph(db, q, { limit }).hits
        .sort((a, b) => b.num - a.num).slice(0, limit)
    })()
  let inherited = hits.filter((r) =>
    opts.work == 'build' &&
    !(r.comps.decided && r.comps.decided.verdict != 'declined')
  )
  let auth = opts.recursive
    ? workAuthorizations(db, inherited, WORK_REFS_LIMIT)
    : new Map<string, { from: string[]; truncated: boolean }>()
  let sets = opts.work == 'evaluate'
    ? workBlockers(db, hits.map((r) => r.eid), WORK_REFS_LIMIT)
    : hits.map((r) => ({ parent: r.eid, items: [], truncated: false }))
  let blockers = new Map(sets.map((set) => [set.parent, set]))
  let holders = new Map(
    rowsFor(
      db,
      sets.flatMap((set) =>
        set.items.map((r) => String(r.comps.claim?.session ?? ''))
      ),
    ).filter((r) => !r.comps.quarantined).map((r) => [r.eid, r]),
  )
  let verification = opts.work == 'verify'
    ? workVerifications(db, hits)
    : new Map<string, WorkProjection['verification']>()
  for (let row of hits) {
    let direct = !!row.comps.decided &&
      row.comps.decided.verdict != 'declined'
    let inheritedAuth = auth.get(row.eid)
    let set = blockers.get(row.eid) ?? {
      parent: row.eid,
      items: [],
      truncated: false,
    }
    let projection: WorkProjection = {
      ...(direct
        ? {
          authorization: {
            kind: 'direct' as const,
            from: [idOf(row)],
            truncated: false,
          },
        }
        : inheritedAuth
        ? {
          authorization: {
            kind: 'inherited' as const,
            from: inheritedAuth.from,
            truncated: inheritedAuth.truncated,
          },
        }
        : {}),
      blockers: {
        items: set.items.map((blocker) => {
          let holder = holders.get(String(blocker.comps.claim?.session ?? ''))
          return {
            id: idOf(blocker),
            title: String(blocker.comps.doc?.title ?? ''),
            status: statusOf(blocker.comps),
            claim: holder ? idOf(holder) : null,
          }
        }),
        truncated: set.truncated,
      },
      ...(verification.get(row.eid)
        ? { verification: verification.get(row.eid) }
        : {}),
    }
    row.comps.work = projection as unknown as Record<string, unknown>
  }
  return hits
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
  // The LINE's own window (`.limit=`/`.after=`) is the default; an explicit
  // opts bound — the /query door's paging — overrides it, so a caller that
  // always passed a limit keeps doing exactly what it did.
  let asked = resolveRefs(parseQuery(q), (id) => locate(db, id))
  if (orderOf(asked) == 'similar') {
    throw new Error('similarity rank requires the embedding query evaluator')
  }
  let win = merged(windowOf(asked), opts)
  let after = win.after ?? 0
  let limit = win.limit ?? ENTRY_PAGE
  // Text retrieval is a query, not a second HTTP resource. FTS decides the
  // order and contributes a query-result-only `rank` component; stored rows
  // never wear it and `comps` never admits it on write. Keeping the metadata
  // beside the ordinary components lets every /query consumer use one row
  // shape while renderers still receive snippets and comment destinations.
  if (asked.some((p) => p.op == 'text') || orderOf(asked) == 'search') {
    let hits = search(db, q, win.limit ?? ENTRY_PAGE).map((h) => {
      let row = rowed({ eid: h.eid, comps: eager(db, h.eid) })
      row.comps.rank = {
        title: h.title,
        title_hit: h.title_hit,
        snip: h.snip,
        score: Number(h.score ?? 0),
        open: h.open,
        ...(h.open_id ? { open_id: h.open_id } : {}),
        ...(h.retired ? { retired: true } : {}),
      }
      return row
    })
    return { preds: asked, hits }
  }
  // An EXPLICIT limit bounds an eager answer too — the newest `limit` by num,
  // returned in num order, and `after` continues that window below a num.
  // Entry pages keep their own seq paging; a caller that named no window keeps
  // the whole eager answer, as before.
  let cut = (hits: Row[]) => {
    let rows = win.after != null ? hits.filter((r) => r.num < win.after!) : hits
    return win.limit != null && rows.length > win.limit
      ? rows.sort((a, b) => b.num - a.num).slice(0, win.limit)
        .sort((a, b) => a.num - b.num)
      : rows
  }
  let fast = evalFast(db, q, false, win)
  if (fast && orderOf(fast.preds) != 'hot') {
    return {
      preds: fast.preds,
      hits: fast.entries
        ? orderedEntries(fast.hits, after, limit)
        : cut(fast.hits.sort((a, b) => a.num - b.num)),
    }
  }
  let { preds, ent, hits } = evalQuery(db, q, after, limit)
  let now = Date.now()
  if (orderOf(preds) == 'hot') {
    hits = hits.sort((a, b) =>
      warm(b.comps, now, ent) - warm(a.comps, now, ent)
    )
    // A hot ranking is its OWN order, so its window is a prefix of that
    // ranking rather than of the spine — `after` names no cursor into it.
    if (win.limit != null) hits = hits.slice(0, win.limit)
  } else if (namesLazy(preds)) hits = orderedEntries(hits, after, limit)
  else hits = cut(hits)
  return { preds, hits }
}

// The DEFINING sets a working-set boot seeds — the canvas chrome and the nav's
// own queries (a client subscribes to exactly these on mount, and a
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

// The working-set boot (M-21143 / T-18059): a joining client seeds the DEFINING
// sets it will subscribe to — NOT the long tail (old tasks, entries, memories,
// comments, mail: the bulk of a whole-graph snapshot), which streams as views
// mount. Same Snapshot shape as snapshot(), so the client's seedFrom seeds it
// unchanged — a PARTIAL cache by construction, kept complete for membership by
// the server subscriptions queryEids opens. queryEids resolving server-side
// (T-17126) and subs bounded to defining queries (T-21283) are what make this
// safe. A cold boot serves this instead of the 44MB whole-graph snapshot() —
// measured 1.62MB vs 42MB on a live-size copy.
//
// TWO things this used to ship and no longer does, because both now have a
// SCOPED delivery (T-22371, D-22567 rung 2):
//   - `allDeps(db)`: every edge between two eager entities, on every join —
//     because edges had no other way to reach a client. On a copy of the live
//     graph that was 4,909 triples, 557 KB, 81% of the whole frame (691,542
//     bytes before, 127,243 after). They ride the `.edges!` RIDER now, incident
//     to a subscription's own result set.
//   - the one-hop walk to each card's `target`: a pinned card's entity, preseeded
//     because the canvas painted it with no sub of its own. Each Card holds a
//     route sub for its target now (live.ts routeSub), so the entity arrives —
//     and LEAVES — with the card that shows it.
// `deps: []` stays in the frame because Snapshot's shape is the client's seed
// contract; it is now always empty, and seedFrom no longer reads it as truth.
export let workingSet = (db: DatabaseSync): Snapshot => {
  let ids = new Set<string>()
  for (let q of WS_SETS) for (let r of evalGraph(db, q).hits) ids.add(r.eid)
  let changes: Change[] = []
  for (let eid of ids) {
    for (let [name, comp] of Object.entries(eager(db, eid))) {
      changes.push({ eid, name, comp: comp as Change['comp'] })
    }
  }
  return {
    changes,
    deps: [],
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
  if (opts?.work) {
    if (named.length) throw new Error('work queries do not accept id=')
    return evalWork(db, q, { ...opts, work: opts.work })
  }
  if (!named.length) return evalGraph(db, q, opts).hits
  // A tombstoned entity still resolves by name but has left the graph, and its
  // spine row now survives the delete (D-18866) — exclude it so `id=` addresses
  // live entities only, matching the /query door and snapshot().
  let only = (named.map((i) => locate(db, i)).filter(Boolean) as string[])
    .filter((eid) => !buried(db, eid))
  // `id=` already SELECTED — the addresses are the selection, and a remaining
  // filter only SCREENS them. No remaining filter means no screen, so this
  // caller states that before parsing (an empty QUERY would select nothing).
  let preds = q.trim() ? resolveRefs(parseQuery(q), (id) => locate(db, id)) : []
  let read = (e: string) => eager(db, e)
  let kids = (eid: string, comp: string, prop: string) =>
    referrersOf(db, [eid], { comp, prop }).map(read)
  let walk = walker(db)
  let fts = (eid: string, p: Pred) => textMatches(db, eid, p)
  return withResults(
    db,
    preds,
    only.map((eid) => rowed({ eid, comps: eager(db, eid) })),
  )
    .filter((r) =>
      listed(r.comps, preds) &&
      matchQuery(r.comps, preds, read, undefined, kids, walk, fts)
    )
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
