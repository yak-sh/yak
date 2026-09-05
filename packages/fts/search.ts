// Ranked results, with a snippet.
//
// The extension (./compile.ts) answers MEMBERSHIP — which entities a search
// selects. This module answers the other question a search box asks: of those,
// which come first, and what did they say? That is FTS5's `bm25` relevance and
// its `snippet`, which are only readable in a statement that queries the index
// itself, so this builds that statement.
//
// `hits()` is the statement, pure: SQL and params a caller runs through
// anything, sync or async. `find()` runs it through a driver and hands back
// {@link Hit}s. Ranking is relevance ALONE; blending in recency, popularity or
// anything else is an application's policy, applied to what comes back.

import type { Eid } from '@yaks/graph'
import { type Field, indexes, indexName } from './fields.ts'
import { CLOSE, OPEN, term } from './term.ts'
import type { Driver } from './driver.ts'

// One search hit: the entity, its rank, and a snippet marking the matches.
export type Hit = {
  // the matched entity
  entity: Eid
  // the relevance rank — FTS5's bm25, where LOWER is a closer match
  rank: number
  // the matching text with each hit wrapped in OPEN…CLOSE, for display
  snippet: string
}

// A statement and the params it binds, in order — @yaks/sql's compiled shape,
// so a filter compiled there can be handed straight in as a `screen`.
export type Stmt = { sql: string; params: (string | number)[] }

export type SearchOpts = {
  // how many hits at most (default 20)
  limit?: number
  // a statement selecting the `eid`s a hit must be among — hand it what
  // @yaks/sql compiled for the rest of the query line, and the words rank only
  // what the filters already allow
  screen?: Stmt
  // how many words of context a snippet carries (default 10)
  context?: number
}

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// The ranked statement for a search, or null when the text holds no word.
//
// One arm per index, unioned; the outer statement joins the spine for the eid,
// drops the graves, and keeps one row per entity. `min(rank)` picks an entity's
// best-matching index, and the snippet beside it comes from THAT row — SQLite
// answers a bare column beside a lone `min()` from the row the minimum came
// from, which is exactly the pairing wanted.
export let hits = (
  fields: Field[],
  text: string,
  opts: SearchOpts = {},
): Stmt | null => {
  let t = term(text)
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
  return {
    sql: `select "entity"."eid" as entity, min("hit"."rank") as rank,` +
      ` "hit"."snippet" as snippet from (${union}) as "hit"` +
      ` join "entity" on "entity"."id" = "hit"."owner"` +
      ` where not exists (select 1 from "tombstone" "t"` +
      ` where "t"."entity" = "entity"."id")${screen}` +
      ` group by "hit"."owner" order by rank limit ?`,
    params,
  }
}

// The hits for a search, closest first. Answers [] for text with no word in it
// and for a vocabulary with nothing indexed — a search that cannot be asked
// finds nothing, rather than everything.
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
