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
  type Driver,
  eq,
  exists,
  fn,
  join,
  lit,
  not,
  op,
  type Raw,
  render,
  type Select,
  select,
  sub,
  table,
  unionAll,
  val,
  when,
} from '@yaks/sql'
import { type Field, indexes, indexName } from './fields.ts'
import { CLOSE, match, OPEN } from './term.ts'

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
// The ranking is `best` (see `chosen`); a snippet is read last, and only for
// the rows returned. FTS5 reads a row's text back to cut one, and a search
// over transcripts matches thousands of rows, some of them megabytes of
// command output: cutting a snippet for every match before choosing twenty
// took seconds where ranking alone takes milliseconds.
export let hits = (
  fields: Field[],
  text: string,
  opts: SearchOpts = {},
): Raw | null => {
  let t = match(text)
  let best = chosen(fields, t, opts)
  if (!best) return null
  let context = opts.context ?? 10
  let b = at('best')
  let snippet = when(
    indexes(fields).map(({ name }, i) => {
      let fts = indexName(name)
      return [
        lit(i),
        sub(select({
          cols: [fn(
            'snippet',
            col(fts),
            lit(-1),
            val(OPEN),
            val(CLOSE),
            lit('…'),
            lit(context),
          )],
          from: table(fts),
          where: and(
            op('match', col(fts), val(t)),
            eq(col('rowid'), b('owner')),
          ),
        })),
      ]
    }),
    undefined,
    b('arm'),
  )
  return render({ ...best, cols: [...best.cols!, as(snippet, 'snippet')] })
}

// The same ranking over a match expression already built from the words
// (term.ts), without snippets — what `.order=search` ranks by (./compile.ts).
// Each row carries the entity's integer `owner`.
export let ranked = (
  fields: Field[],
  t: string,
  opts: SearchOpts = {},
): Raw | null => {
  let best = chosen(fields, t, opts)
  return best && render(best)
}

// The ranking both statements share: every match with its bm25 rank and the
// index it came from (`hit`), then the best `limit` entities (`best`), which
// joins `entity` for the eid, excludes deleted entities and keeps one row per
// entity. `min(rank)` picks an entity's best-matching index, and the `arm`
// selected alongside it names that index — SQLite returns a bare column
// selected next to a single `min()` from the row the minimum came from, which
// is exactly the pairing wanted here.
//
// Both are materialized, and it is not decoration: FTS5's `bm25` and `snippet`
// may only be used in a statement that matches the index, and SQLite's query
// flattener would fold a plain subquery into the join above it, moving them
// out of that context and raising "unable to use function bm25 in the
// requested context".
let chosen = (
  fields: Field[],
  t: string,
  opts: SearchOpts,
): Select | null => {
  let arms = indexes(fields)
  if (!t || !arms.length) return null
  let e = at('entity')
  let hit = at('hit')
  let b = at('best')
  let hits = unionAll(...arms.map(({ name }, i) => {
    let fts = indexName(name)
    return select({
      cols: [
        as(col('rowid'), 'owner'),
        as(fn('bm25', col(fts)), 'rank'),
        as(lit(i), 'arm'),
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
  let best = select({
    cols: [
      as(e('eid'), 'entity'),
      as(hit('owner'), 'owner'),
      as(fn('min', hit('rank')), 'rank'),
      as(hit('arm'), 'arm'),
    ],
    from: table('hit'),
    joins: [join(table('entity'), eq(e('id'), hit('owner')))],
    where: opts.screen ? and(alive, among(e('eid'), opts.screen)) : alive,
    group: [hit('owner')],
    order: [col('rank')],
    limit: val(opts.limit ?? 20),
  })
  return select({
    with: [
      { name: 'hit', q: hits, materialized: true },
      { name: 'best', q: best, materialized: true },
    ],
    cols: [
      as(b('entity'), 'entity'),
      as(b('owner'), 'owner'),
      as(b('rank'), 'rank'),
    ],
    from: table('best'),
    order: [b('rank')],
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
  return db.query(stmt).map((r) => ({
    entity: String(r.entity),
    rank: Number(r.rank),
    snippet: String(r.snippet ?? ''),
  }))
}
