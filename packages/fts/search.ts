// Ranked results, with a snippet.
//
// The extension (./compile.ts) decides membership — which entities a search
// selects. This module answers the other question a search box asks: of those,
// which come first, and what text matched? That is FTS5's `bm25` relevance and
// its `snippet()`, both of which can only be read in a statement that queries
// the index itself, so this module builds that statement.
//
// `hits()` only builds it: it returns SQL and params the caller may run through
// anything, sync or async. `find()` runs it through a driver and returns
// {@link Hit}s. Ranking is by relevance alone; mixing in recency, popularity or
// anything else is an application's policy, applied to the results it gets
// back.

import type { Eid } from '@yaks/graph'
import { type Field, indexes, indexName } from './fields.ts'
import { CLOSE, match, OPEN } from './term.ts'
import type { Driver } from './driver.ts'

// One search hit: the entity, its rank, and a snippet marking the matches.
export type Hit = {
  // the matched entity
  entity: Eid
  // the relevance rank — FTS5's bm25, where a lower number is a closer match
  rank: number
  // the matching text with each match wrapped in OPEN…CLOSE, for display
  snippet: string
}

// A statement and the params it binds, in order — the shape @yaks/sql compiles
// to, so a filter compiled there can be passed straight in as a `screen`.
export type Stmt = { sql: string; params: (string | number)[] }

export type SearchOpts = {
  // how many hits at most (default 20)
  limit?: number
  // a statement selecting the `eid`s a hit must be among — pass what @yaks/sql
  // compiled for the rest of the query, and only rows the filters already allow
  // are ranked
  screen?: Stmt
  // how many words of context a snippet carries (default 10)
  context?: number
}

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// The ranked statement for a search, or null when the text contains no word.
// The words are ANDed terms (./term.ts) and bm25 orders the results, so a
// search behaves as a set of words rather than as one phrase.
//
// One subquery per index, combined with `union all`; the outer statement joins
// the `entity` table for the eid, excludes deleted entities, and keeps one row
// per entity. `min(rank)` picks an entity's best-matching index, and the
// snippet selected alongside it comes from that row — SQLite returns a bare
// column selected next to a single `min()` from the row the minimum came from,
// which is exactly the pairing wanted here.
export let hits = (
  fields: Field[],
  text: string,
  opts: SearchOpts = {},
): Stmt | null => ranked(fields, match(text), opts)

// The same statement over a match expression already built from the words
// (term.ts) — what `.order=search` ranks by (./compile.ts). Each row also
// carries the entity's integer `owner`.
export let ranked = (
  fields: Field[],
  t: string,
  opts: SearchOpts = {},
): Stmt | null => {
  let arms = indexes(fields)
  if (!t || !arms.length) return null
  let context = opts.context ?? 10
  let params: (string | number)[] = []
  let union = arms.map(({ comp }) => {
    let fts = q(indexName(comp))
    params.push(OPEN, CLOSE, t)
    return `select rowid as owner, bm25(${fts}) as rank,` +
      ` snippet(${fts}, -1, ?, ?, '…', ${context}) as snippet` +
      ` from ${fts} where ${fts} match ?`
  }).join(' union all ')
  let screen = opts.screen ? ` and "entity"."eid" in (${opts.screen.sql})` : ''
  if (opts.screen) params.push(...opts.screen.params)
  params.push(opts.limit ?? 20)
  // Materialized, and it is not decoration: FTS5's `bm25` and `snippet` may
  // only be used in a statement that matches the index, and SQLite's query
  // flattener would fold a plain subquery into the join above it, moving them
  // out of that context and raising "unable to use function bm25 in the
  // requested context". Two or more indexes produce a `union all`, which is
  // never flattened, so the error only ever appeared for a vocabulary with one
  // indexed component.
  return {
    sql: `with "hit" as materialized (${union})` +
      ` select "entity"."eid" as entity, "hit"."owner" as owner,` +
      ` min("hit"."rank") as rank,` +
      ` "hit"."snippet" as snippet from "hit"` +
      ` join "entity" on "entity"."id" = "hit"."owner"` +
      ` where not exists (select 1 from "tombstone" "t"` +
      ` where "t"."entity" = "entity"."id")${screen}` +
      ` group by "hit"."owner" order by rank limit ?`,
    params,
  }
}

// The hits for a search, closest first. Returns [] for text containing no word
// and for a vocabulary with nothing indexed — a search that cannot be run finds
// nothing, rather than everything.
export let find = (
  db: Driver,
  fields: Field[],
  text: string,
  opts: SearchOpts = {},
): Hit[] => {
  let stmt = hits(fields, text, opts)
  if (!stmt) return []
  return db.query(stmt.sql, stmt.params).map((r) => ({
    entity: String(r.entity),
    rank: Number(r.rank),
    snippet: String(r.snippet ?? ''),
  }))
}
