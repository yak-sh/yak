// The /query door over a store: the query string IS the filter line — the
// grammar boards and task_list speak — and hits come back shaped like every
// entity JSON door. The DOOR is graph_query.ts (askOf → askRows → layered), the
// same one src/server_runtime.ts's route and the CLI's local arm read; this
// module is the store's adapter to it, and carries only what a Cloudflare store
// cannot serve: `work=` lanes (the server's graphIO) and `.order=similar` (the
// embedding provider), refused rather than guessed.
//
// It was a PORT of the server's handler, and the copy drifted exactly as a copy
// does — the per-id hydration fix that landed twice on the other two doors
// (0d4d4b4a, 2f0b8ed7) never reached this one at all, so a `id=` fetch here
// still paid a statement per component per entity. There is one implementation
// now, and a fix to any arm is a fix to every store.
import type { Sql } from '../../src/store/sql.ts'
import { isPerson, locate, rowsOf, titleOf, vocabOf } from '../../src/db.ts'
import {
  orderOf,
  parseQuery,
  type Pred,
  resolveRefs,
  TEXT,
} from '../../src/query.ts'
import {
  askOf,
  askRows,
  evalAgg,
  layered,
  rowed,
} from '../../src/graph_query.ts'
import type { Frame } from '../../src/subserve.ts'
import { type Change, comps, stamped } from '../../src/types.ts'
import { listed, named, type Ref, type Row } from './listing.ts'

// Which columns hold a REFERENCE, in this store's whole vocabulary: the
// platform's words, the stamps it keeps about a row, and the app's own.
let refs = (db: Sql): Ref => (comp, col) => {
  let type = comps[comp]?.[col] ?? stamped[comp]?.[col] ??
    vocabOf(db)[comp]?.[col]
  return !!type && typeof type == 'object' && 'eid' in type
}

// Who this store knows by name. It mints a person row for whoever writes to
// it, titled with what to call them (store.ts `knows`), so a reference it can
// name is a person it has met — and anything else keeps the eid it had.
let people = (db: Sql) => (eids: string[]) => {
  let out = new Map<string, string>()
  for (let eid of eids) {
    let name = isPerson(db, eid) ? titleOf(db, eid) : ''
    if (name) out.set(eid, name)
  }
  return out
}

// The rows a door answers with, speaking human: one projection, so `query()`,
// `subscribe()`, graph_query and a declared tool's `query` carry the same
// byline (listing.ts `named`).
let speaking = (db: Sql, rows: Row[]): Row[] =>
  named(rows, refs(db), people(db))

// What a listing CARRIES, beside what it selects (Jeff, 2026-09-03): "we
// should query for the exact components we want: `.book!&.recipe?` = must be
// book, recipe is optional but requested. asking for all comps is i imagine
// most useful for debugging". So an answer carries the components the filter
// NAMES — by presence (`.book!`), by request (`.loan?`, query.ts WANT), or by
// a predicate of its own — and nothing else; `*` is the debugging form that
// asks for every component, and a filter that names none (an `id=` fetch)
// left nothing out, so it answers the whole bundle. A component asserted
// ABSENT (`.archived=`) names no component the answer could carry, which is
// also what keeps the door's own platform screens (listing.ts `asking`) from
// counting as a request.
//
// Nor does a bare WORD name one. A text term's `comp: 'doc'` is decorative —
// src/query.ts says so at the pred, since matchQuery matches title and body as
// one — and reading it as a request made `search('lemon')` answer a doc, a
// rank, and none of the app's own components, so a page drawing cards from a
// search drew blanks (T-33144). A search that names no component is the `id=`
// case: it left nothing out, so it answers the whole bundle, which is also
// the only useful answer when the caller does not yet know what they found.
export let EVERY = '*'

let wanted = (segs: string[], preds: Pred[]): Set<string> | null => {
  if (segs.includes(EVERY)) return null
  let want = new Set(
    preds.filter((p) =>
      p.comp && p.op != TEXT && !(p.prop == '' && p.op == '' && p.value == '')
    ).map((p) => p.comp),
  )
  return want.size ? want : null
}

// The rows, cut to what was asked for. The spine and the kind NAME a row, and
// a text query's `rank` is the answer's own metadata about it, so those three
// ride whatever the filter said.
let only = (rows: unknown, want: Set<string> | null) =>
  !want || !Array.isArray(rows)
    ? rows
    : (rows as Row[]).map((r) =>
      Object.fromEntries(
        Object.entries(r).filter(([k]) =>
          k == 'entity' || k == 'kind' || k == 'rank' || want.has(k)
        ),
      )
    )

export let query = async (db: Sql, search: string): Promise<unknown> => {
  let segs = search.slice(1).split('&').filter(Boolean).map(decodeURIComponent)
  // `*` is the listing's word, not the grammar's — a bare word would be an
  // FTS term — so it never reaches the parser.
  let ask = askOf(segs.filter((seg) => seg != EVERY))
  if (ask.work) throw new Error('work lanes are not served by this store')
  let q = ask.filters.join('&')
  // The refusal is this store's, not the door's: askRows would decline a
  // similarity order too (no ranker is registered here, since embed.ts's vector
  // backend cannot ride a worker bundle), but it says so in the app plane's
  // words. A store that cannot serve a capability names itself.
  let asked = q.trim()
    ? resolveRefs(parseQuery(q, vocabOf(db)), (id) => locate(db, id))
    : []
  if (orderOf(asked) == 'similar') {
    throw new Error('semantic ranking is not served by this store')
  }
  // An aggregate projection answers with the reduction, not a row set.
  let agg = evalAgg(db, q)
  if (agg) {
    if (agg.op == 'count') return { count: agg.values.get('') ?? 0 }
    let keys = [...agg.values.keys()].sort()
    return agg.op == 'distinct' ? { distinct: keys } : {
      tally: Object.fromEntries(keys.map((k) => [k, agg.values.get(k)])),
    }
  }
  return speaking(
    db,
    only(
      layered(db, await askRows(db, ask), ask),
      wanted(segs, asked),
    ) as Row[],
  )
}

// The rows a filter line answers for a KNOWN set of eids — the `id=` arm of
// askRows without the re-screen, since a subscription's membership already
// answered the filter. One statement per component table (rowsOf), then the
// door's own projection.
let rowsAt = (db: Sql, eids: string[], asked: string): Row[] => {
  if (!eids.length) return []
  let segs = asked.split('&').filter(Boolean)
  let ask = askOf(segs.filter((seg) => seg != EVERY))
  let q = ask.filters.join('&')
  // A subscription's line was already accepted once; if it no longer parses,
  // the frame still ships, whole.
  let want: Set<string> | null = null
  try {
    want = wanted(segs, q.trim() ? parseQuery(q, vocabOf(db)) : [])
  } catch { /* the whole bundle, then */ }
  let rows = listed(
    layered(db, rowsOf(db, eids).map(rowed), ask) as Row[],
    asked,
  )
  return speaking(db, only(rows, want) as Row[])
}

// The live door's frames, answered by the SAME projection: a subscription is
// "query that keeps answering" (public/client.js), so what it delivers must be
// what /query delivers — `kind`, the doc body, no eid inside a component, and
// the listing's own rule about the platform's stamps. Streaming the wire's raw
// changes made it something else, and a journal's first push wiped the words it
// had painted from `query()` (C-32624 item 2).
//
// So a row frame is re-read as ROWS: the eids the frame mentions, through
// rowsOf → layered → listed → named, exactly as an `id=` ask would answer
// them — the byline included (listing.ts). A death
// and a row the listing leaves out both become drops, since neither is in the
// answer. Every other frame (an aggregate, an error, the join handshake) is not
// a row listing and passes through as it came.
export let answered = (db: Sql, f: Frame, asked: string): Frame => {
  if (Array.isArray(f) || !Array.isArray(f.changes)) return f
  let changes = f.changes as Change[]
  let gone = new Set(
    changes.filter((c) => c.name == 'entity' && c.comp == null)
      .map((c) => c.eid),
  )
  let eids = [...new Set(changes.map((c) => c.eid))].filter((e) => !gone.has(e))
  let rows = rowsAt(db, eids, asked)
  let kept = new Set(rows.map((r) => (r.entity as { eid: string }).eid))
  let { changes: _, drop, ...rest } = f
  return {
    ...rest,
    rows,
    drop: [
      ...(drop as string[] ?? []),
      ...gone,
      ...eids.filter((e) => !kept.has(e)),
    ],
  }
}
