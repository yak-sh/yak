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
import {
  among,
  and,
  as,
  at,
  col,
  eq,
  exists,
  fn,
  join,
  lit,
  not,
  op,
  type Raw,
  render,
  select,
  table,
  unionAll,
  val,
} from '@yaks/sql'
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

export type SearchOpts = {
  // how many hits at most (default 20)
  limit?: number
  // a statement selecting the `eid`s a hit must be among — pass what @yaks/sql
  // compiled for the rest of the query, and only rows the filters already allow
  // are ranked
  screen?: Raw
  // how many words of context a snippet carries (default 10)
  context?: number
}

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
): Raw | null => ranked(fields, match(text), opts)

// The same statement over a match expression already built from the words
// (term.ts) — what `.order=search` ranks by (./compile.ts). Each row also
// carries the entity's integer `owner`.
export let ranked = (
  fields: Field[],
  t: string,
  opts: SearchOpts = {},
): Raw | null => {
  let arms = indexes(fields)
  if (!t || !arms.length) return null
  let context = opts.context ?? 10
  let e = at('entity')
  let hit = at('hit')
  // Materialized, and it is not decoration: FTS5's `bm25` and `snippet` may
  // only be used in a statement that matches the index, and SQLite's query
  // flattener would fold a plain subquery into the join above it, moving them
  // out of that context and raising "unable to use function bm25 in the
  // requested context". Two or more indexes produce a `union all`, which is
  // never flattened, so the error only ever appeared for a vocabulary with one
  // indexed component.
  let hits = unionAll(...arms.map(({ comp }) => {
    let fts = indexName(comp)
    return select({
      cols: [
        as(col('rowid'), 'owner'),
        as(fn('bm25', col(fts)), 'rank'),
        as(
          fn(
            'snippet',
            col(fts),
            lit(-1),
            val(OPEN),
            val(CLOSE),
            lit('…'),
            lit(context),
          ),
          'snippet',
        ),
      ],
      from: table(fts),
      where: op('match', col(fts), val(t)),
    })
  }))
  let alive = not(exists(select({
    cols: [lit(1)],
    from: table('tombstone', 't'),
    where: eq(col('entity', 't'), e('id')),
  })))
  return render({
    t: 'select',
    with: [{ name: 'hit', q: hits, materialized: true }],
    cols: [
      as(e('eid'), 'entity'),
      as(hit('owner'), 'owner'),
      as(fn('min', hit('rank')), 'rank'),
      as(hit('snippet'), 'snippet'),
    ],
    from: table('hit'),
    joins: [join(table('entity'), eq(e('id'), hit('owner')))],
    where: opts.screen ? and(alive, among(e('eid'), opts.screen)) : alive,
    group: [hit('owner')],
    order: [col('rank')],
    limit: val(opts.limit ?? 20),
  })
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
