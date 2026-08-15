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
import type { DatabaseSync } from 'node:sqlite'
import { kindOf, sessionOf } from './types.ts'
import { find, type Row, rows } from './client.ts'
import { entriesOf, entriesScan, locate, matching, snapshot } from './db.ts'
import { where } from './sql.ts'
import {
  kidsOf,
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

// The JS matcher over the full graph — the fallback for a predicate the index
// declined, and a subscription's initial set. When the query names the lazy
// partition the universe gains its entries (the snapshot omits them), so a lazy
// pred the index could not compile is still answered without dropping the
// partition. `preds`/`byEid`/`snap`/`all` ride out for whoever ranks on top.
export let evalQuery = (
  db: DatabaseSync,
  q: string,
  after = 0,
  limit = ENTRY_PAGE,
) => {
  let snap = snapshot(db)
  let all = rows(snap, true)
  let preds = resolveRefs(parseQuery(q), (id) => find(all, id)?.eid)
  if (namesLazy(preds)) {
    all = [...all, ...entryUniverse(db, preds, after, limit)]
  }
  let byEid = new Map(all.map((r) => [r.eid, r.comps]))
  // A reverse hop reads the children pointing back at each row; kidsOf builds
  // that reverse view over the same universe, so the JS fallback answers a
  // `.comments…` hop identically to the index EXISTS.
  let kids = kidsOf(byEid)
  let hits = all.filter((r) =>
    listed(r.comps, preds) &&
    matchQuery(r.comps, preds, (e) => byEid.get(e), undefined, kids)
  )
  return { snap, all, preds, byEid, hits }
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
  let { preds, byEid, hits } = evalQuery(db, q, after, limit)
  let now = Date.now()
  if (orderOf(preds) == 'hot') {
    hits = hits.sort((a, b) =>
      warm(b.comps, now, (e) => byEid.get(e)) -
      warm(a.comps, now, (e) => byEid.get(e))
    )
  } else if (namesLazy(preds)) hits = orderedEntries(hits, after, limit)
  return { preds, hits }
}
