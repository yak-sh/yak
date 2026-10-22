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
  type BindOpts,
  col,
  desc,
  type Driver,
  eq,
  exists,
  type Expr,
  fn,
  from,
  lit,
  not,
  op,
  or,
  type Query,
  type Raw,
  render,
  type Select,
  select,
  sourceScreen,
  sub,
  table,
  unionAll,
  val,
  when,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { type Field, type Index, indexes, indexName } from './fields.ts'
import { CLOSE, excerpt, match, named, OPEN } from './term.ts'

// One search hit: the entity, its rank, and a snippet marking the matches.
export type Hit = {
  // the matched entity
  entity: Eid
  // the relevance rank — FTS5's bm25, where a lower number is a closer match
  rank: number
  // matching text with distinctive terms wrapped in OPEN…CLOSE for display
  snippet: string
}

export type SearchOpts = {
  // how many hits at most (default 20)
  limit?: number
  // a statement selecting the ids of the entities a hit must be among — pass
  // @yaks/sql's `screen` of the rest of the query, and only rows the filters
  // already allow are ranked
  screen?: Raw
  // the owner ids permitted to contribute matching text, per index
  screens?: Record<string, Raw>
  // how many words of context a snippet carries (default 10)
  context?: number
  // the words as a name is written (./term.ts `named`): a hit whose stored
  // text is exactly this ranks before every other. `hits()` reads it off its
  // text; `ranked()` is handed it beside the match it ranks by
  name?: string
}

// Each index has one text source and may be gated by another component.
// Restrict both before matching, so a public owner cannot reveal private text.
export let screens = (
  fields: Field[],
  vocab: Vocab,
  opts: BindOpts,
): Record<string, Raw> =>
  Object.fromEntries(
    indexes(fields).flatMap(({ name, comp, on }) => {
      let screen = sourceScreen(vocab, opts, [comp, ...on ? [on] : []])
      return screen ? [[name, screen]] : []
    }),
  )

export let permitted = (
  name: string,
  owner: ReturnType<typeof col>,
  screens?: Record<string, Raw>,
): Expr => {
  let screen = screens?.[name]
  return screen
    ? exists(select({
      cols: [lit(1)],
      from: from(screen, '__allowed'),
      where: eq(col('id', '__allowed'), owner),
    }))
    : lit(true)
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
  let best = chosen(fields, t, { name: named(text), ...opts })
  if (!best) return null
  let context = opts.context ?? 10
  // Membership and rank still use the full match; the excerpt leaves common
  // terms unmarked, so FTS5 does less work cutting large matching texts.
  let marked = excerpt(text)
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
            op('match', col(fts), val(marked)),
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
// A name comes first. bm25 rewards a word said often in a short text, so a
// task saying "Mossvale" twice in its title outranks the project whose title
// is the one word, which sat past a hundred others for `mossvale`. So the
// matches whose stored text is exactly the words, ignoring case (`named`),
// rank before every other, bm25 orders each tier, and equal matches go newest
// first, as a listing does. They are found through the index, as rows whose
// text begins with the words (FTS5's `^`), and only those rows are read to
// compare. A property kept elsewhere is compared as stored: a body @yaks/blob
// holds is its address, never its words.
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
  let eligible = (owner: Expr) =>
    exists(select({
      cols: [lit(1)],
      from: table('__fts_screen'),
      where: eq(col('id', '__fts_screen'), owner),
    }))
  // An index's rows matching `expr`, among the owners the caller admits.
  let admitted: Admitted = (name, expr) => {
    let fts = indexName(name)
    return and(
      op('match', col(fts), val(expr)),
      permitted(name, col('rowid', fts), opts.screens),
      // Rank only admitted owners: materializing every text match first
      // reads excluded content and leaves the outer join a broad hit set.
      ...opts.screen ? [eligible(col('rowid', fts))] : [],
    )
  }
  let hits = unionAll(...arms.map(({ name }, i) => {
    let fts = indexName(name)
    return select({
      cols: [
        as(col('rowid'), 'owner'),
        as(fn('bm25', col(fts)), 'rank'),
        as(lit(i), 'arm'),
      ],
      from: table(fts),
      where: admitted(name, t),
    })
  }))
  let alive = not(exists(select({
    cols: [lit(1)],
    from: table('tombstone', 't'),
    where: eq(col('entity', 't'), e('id')),
  })))
  let name = opts.name ? exactly(arms, opts.name, admitted) : null
  let best = select({
    cols: [
      as(e('eid'), 'entity'),
      as(hit('owner'), 'owner'),
      as(fn('min', hit('rank')), 'rank'),
      as(hit('arm'), 'arm'),
      as(
        // `in` keys the named owners once; a correlated probe would scan
        // them for every hit.
        name
          ? among(
            hit('owner'),
            select({ cols: [col('owner')], from: table('named') }),
          )
          : lit(0),
        'named',
      ),
    ],
    from: table('hit'),
    // The ranked hit set drives owner lookups even with small stale statistics.
    joins: [{ how: 'cross', src: table('entity') }],
    where: and(alive, eq(e('id'), hit('owner'))),
    group: [hit('owner')],
    order: [desc(col('named')), col('rank'), desc(hit('owner'))],
    limit: val(opts.limit ?? 20),
  })
  return select({
    with: [
      ...opts.screen
        ? [{
          name: '__fts_screen',
          cols: ['id'],
          q: opts.screen,
          materialized: false,
        }]
        : [],
      { name: 'hit', q: hits, materialized: true },
      ...name ? [{ name: 'named', q: name, materialized: true }] : [],
      { name: 'best', q: best, materialized: true },
    ],
    cols: [
      as(b('entity'), 'entity'),
      as(b('owner'), 'owner'),
      as(b('rank'), 'rank'),
    ],
    from: table('best'),
    order: [desc(b('named')), b('rank'), desc(b('owner'))],
  })
}

type Admitted = (name: string, expr: string) => Expr

// The admitted owners whose stored text, in any column of an index, is
// exactly `name`: the rows whose text begins with it (`^`), each read once to
// compare.
let exactly = (arms: Index[], name: string, admitted: Admitted): Query =>
  unionAll(...arms.map(({ name: index, comp, props }) => {
    let fts = indexName(index)
    let n = at('__named')
    let same = (p: string) =>
      eq(fn('lower', fn('trim', n(p))), fn('lower', val(name)))
    return select({
      cols: [as(col('rowid'), 'owner')],
      from: table(fts),
      where: and(
        admitted(index, `^"${name.replaceAll('"', '')}"`),
        exists(select({
          cols: [lit(1)],
          from: table(comp, '__named'),
          where: and(
            eq(n('entity'), col('rowid', fts)),
            or(...props.map(same)),
          ),
        })),
      ),
    })
  }))

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
