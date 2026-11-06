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
  absentFrom,
  and,
  as,
  at,
  type BindOpts,
  catalogue,
  col,
  type Cte,
  desc,
  type Driver,
  eq,
  exists,
  type Expr,
  fn,
  from,
  join,
  lit,
  member,
  not,
  op,
  or,
  over,
  type Query,
  type Raw,
  render,
  type Select,
  select,
  type Selection,
  sourceScreen,
  sub,
  table,
  unionAll,
  unionAllWithin,
  val,
  when,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { type Field, type Index, indexes, indexName } from './fields.ts'
import { excerpt, match, named } from './term.ts'
import { cut } from './snippet.ts'

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
  // Index-order pages minimize billed rows; a single SQL sort minimizes CPU
  // when reopening a prefix match to refill tied ranks would cost more.
  plan?: 'index' | 'sort'
  // a statement selecting the ids of the entities a hit must be among — pass
  // @yaks/sql's `screen` of the rest of the query, and only rows the filters
  // already allow are ranked. One the compiler made carries its keyed `probe`
  screen?: Selection
  // the owner ids permitted to contribute matching text, per index
  screens?: Record<string, Raw>
  // how many words of context a snippet carries (default 10)
  context?: number
  // External-content sources, keyed by index. find() reads these from the schema.
  content?: Record<string, string>
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

// Ranking revisits each index for its page, ties and exact names. Bind each
// admission relation once, including when several indexes share its scope.
// Keep it keyed by the matching owner: materializing a broad visibility scope
// enumerates the whole graph before a search can return even one hit.
let shared = (screens: Record<string, Raw> = {}) => {
  let ctes: Cte[] = []
  let held = new Map<string, Raw>()
  let sources = Object.fromEntries(
    Object.entries(screens).map(([index, q]) => {
      let key = JSON.stringify(q)
      let source = held.get(key)
      if (!source) {
        let name = `__fts_allowed${ctes.length}`
        ctes.push({ name, q, materialized: false })
        source = render(select({ cols: [col('id')], from: table(name) }))
        held.set(key, source)
      }
      return [index, source]
    }),
  )
  return { ctes, sources }
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
  let snippets = indexes(fields).map(({ name, props }, i) => {
    let fts = indexName(name)
    return {
      name: `__snippets${i}`,
      materialized: true,
      q: select({
        cols: [
          as(col('rowid', fts), 'owner'),
          as(cut(fts, props, marked, context, opts.content?.[name]), 'snippet'),
        ],
        from: table(fts),
        where: and(
          op('match', col(fts), val(marked)),
          exists(
            select({
              cols: [lit(1)],
              from: table('best'),
              where: and(
                eq(b('arm'), lit(i)),
                eq(b('owner'), col('rowid', fts)),
              ),
            }),
          ),
        ),
      }),
    }
  })
  let snippet = when(
    indexes(fields).map((
      _,
      i,
    ) => [
      lit(i),
      sub(
        select({
          cols: [col('snippet')],
          from: table(`__snippets${i}`),
          where: eq(col('owner'), b('owner')),
        }),
      ),
    ]),
    undefined,
    b('arm'),
  )
  return render({
    ...best,
    with: [...best.with!, ...snippets],
    cols: [...best.cols!, as(snippet, 'snippet')],
  })
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

// The ranking both statements share: the best `limit` entities (`best`), each
// with its bm25 rank and the index it ranked best in (`arm`), one row per
// entity, joined to `entity` for the eid. `min(rank)` picks an entity's
// best-matching index, and the `arm` selected alongside it names that index —
// SQLite returns a bare column selected next to a single `min()` from the row
// the minimum came from, which is exactly the pairing wanted here.
//
// A page stops reading at its best rows. Each index answers only its own best
// `limit` admitted rows (`placing`), through FTS5's own `order by rank`, which
// sorts inside the index and hands back just the rows taken: a yaks.app store
// bills each row a cursor hands back, so a broad word costs a page, not every
// match. The best `limit` entities across indexes are among each index's best
// `limit`, so nothing is lost by cutting each first. Admission (the screen,
// visibility, a tombstone) is tested as the index hands rows back, so a row
// the rest of the query refuses never takes a place.
//
// Equal matches go newest first, as a listing does, but FTS5 hands equal ranks
// back oldest first. So when the row past an index's last place ranks the same
// as that place, the places at that rank are taken again, newest first, by a
// `rowid desc` scan of the rows ranking exactly that (`newest`).
//
// A name comes first. bm25 rewards a word said often in a short text, so a
// task saying "Mossvale" twice in its title outranks the project whose title
// is the one word, which sat past a hundred others for `mossvale`. So the
// matches whose stored text is exactly the words, ignoring case (`exactly`),
// rank before every other. They are found through the index as rows whose
// text begins with the words (FTS5's `^`), and only those rows are read to
// compare.
//
// The steps that rank are materialized, and it is not decoration: FTS5's
// `bm25`, `rank` and `snippet` may only be used in a statement that matches
// the index, and SQLite's query flattener would fold a plain subquery into the
// join above it, moving them out of that context and raising "unable to use
// function bm25 in the requested context".
let chosen = (
  fields: Field[],
  t: string,
  opts: SearchOpts,
): Select | null => {
  let arms = indexes(fields)
  if (!t || !arms.length) return null
  let limit = opts.limit ?? 20
  let sorting = opts.plan == 'sort'
  let { ctes, sources } = shared(opts.screens)
  let e = at('entity')
  let c = at('__candidate')
  let b = at('best')
  // A kind can have no owners in an index at all. Prove that through the
  // selected owners' component keys before opening a CPU-sorted FTS cursor.
  // Joined, not crossed: SQLite drives from the smaller side, so a broad
  // screen seeks a rare component's few owners rather than walking the graph
  // in id order to find one.
  let guarded = sorting && !!opts.screen
  let active = (arm: Index) =>
    exists(select({
      cols: [lit(1)],
      from: table('__fts_screen'),
      joins: [join(
        table(arm.on ?? arm.comp, '__source'),
        eq(col('entity', '__source'), col('id', '__fts_screen')),
      )],
    }))
  let take = (i: number, n: number): Expr =>
    guarded
      ? when([[
        sub(select({ cols: [col(`arm${i}`)], from: table('__fts_active') })),
        lit(n),
      ]], lit(0))
      : lit(n)
  // A screen the compiler made tests one owner by its keyed form, a seek per
  // posting however many owners it admits. A bare relation is read whole.
  let probed = !!opts.screen?.probe
  let eligible = (owner: Expr) =>
    probed ? member(opts.screen!, owner) : exists(select({
      cols: [lit(1)],
      from: table('__fts_screen'),
      where: eq(col('id', '__fts_screen'), owner),
    }))
  // An index's rows matching `expr`, among the live owners the caller admits.
  let admitted: Admitted = (name, expr) => {
    let fts = indexName(name)
    let owner = col('rowid', fts)
    return and(
      op('match', col(fts), val(expr)),
      permitted(name, owner, sources),
      ...opts.screen ? [eligible(owner)] : [],
      not(exists(select({
        cols: [lit(1)],
        from: table('tombstone', 't'),
        where: eq(col('entity', 't'), owner),
      }))),
    )
  }
  // A workerd compound select holds five terms (@yaks/sql's compound.ts), so
  // each kind of candidate takes one term per index, nested to fit however
  // many indexes the vocabulary has, and the kinds are joined above them.
  let kinds = [
    arms.map((_, i) => placed(i, limit, sorting)),
    sorting
      ? []
      : arms.map(({ name }, i) => newest(name, i, t, limit, admitted)),
    opts.name
      ? arms.map((arm, i) =>
        exactly(arm, i, t, opts.name!, take(i, limit), admitted)
      )
      : [],
  ].filter((kind) => kind.length)
  let candidates = unionAll(
    ...kinds.map((kind, k) =>
      select({
        cols: ['owner', 'rank', 'arm', 'named'].map((n) => col(n)),
        from: from(unionAllWithin(kind), `__kind${k}`),
      })
    ),
  )
  let best = select({
    cols: [
      // Read by id for each candidate: joined, SQLite scans `entity` per
      // candidate here, whatever its statistics say.
      as(
        sub(select({
          cols: [e('eid')],
          from: table('entity'),
          where: eq(e('id'), c('owner')),
        })),
        'entity',
      ),
      as(c('owner'), 'owner'),
      as(fn('min', c('rank')), 'rank'),
      as(c('arm'), 'arm'),
      as(fn('max', c('named')), 'named'),
    ],
    from: from(candidates, '__candidate'),
    group: [c('owner')],
    order: [desc(col('named')), col('rank'), desc(c('owner'))],
    limit: val(limit),
  })
  return select({
    with: [
      ...ctes,
      ...opts.screen
        ? [{
          name: '__fts_screen',
          cols: ['id'],
          q: opts.screen,
          // A CPU sort visits every matching posting. A bare relation is
          // shared rather than re-run for every hit; a probed one is never
          // enumerated, since the screen of a broad query is the whole graph.
          // Index-order pages keep candidate seeks for sparse paid reads.
          materialized: sorting && !probed,
        }]
        : [],
      ...guarded
        ? [{
          name: '__fts_active',
          q: select({ cols: arms.map((arm, i) => as(active(arm), `arm${i}`)) }),
          materialized: true,
        }]
        : [],
      ...arms.flatMap(({ name }, i) =>
        placing(
          name,
          i,
          t,
          take(i, sorting ? limit : limit + 1),
          admitted,
          sorting,
        )
      ),
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

// Index `i`'s best admitted rows by rank, one past its last place, and the
// worst rank among them.
let top = (i: number) => `__top${i}`
let edge = (i: number) => `__edge${i}`

// A candidate row: an owner, its rank, its index, and whether it is a name.
let candidate = (owner: Expr, rank: Expr, arm: number, named: 0 | 1) => [
  as(owner, 'owner'),
  as(rank, 'rank'),
  as(lit(arm), 'arm'),
  as(lit(named), 'named'),
]

// Index `i`'s best admitted rows by rank, `limit + 1` of them (`top`), and
// one row (`edge`) saying the worst rank among them, how many share it (`n`)
// and how many they are (`held`), read in one pass.
let placing = (
  name: string,
  i: number,
  t: string,
  limit: Expr,
  admitted: Admitted,
  sorting: boolean,
): Cte[] => [{
  name: top(i),
  q: select({
    cols: [as(col('rowid'), 'owner'), as(col('rank'), 'rank')],
    from: table(indexName(name)),
    where: admitted(name, t),
    order: [col('rank'), ...sorting ? [desc(col('rowid'))] : []],
    limit,
  }),
  materialized: true,
}, {
  name: edge(i),
  q: select({
    cols: [
      col('rank'),
      as(fn('count', lit(1)), 'n'),
      as(over(fn('sum', fn('count', lit(1)))), 'held'),
    ],
    from: table(top(i)),
    group: [col('rank')],
    order: [desc(col('rank'))],
    limit: lit(1),
  }),
  materialized: true,
}]

// Whether index `i`'s `top` holds a row past its last place: then the rows at
// its worst rank are that row and, when it ties, places to take again.
let full = (i: number, limit: number) =>
  op('>', col('held', edge(i)), lit(limit))

// Index `i`'s places ranking better than its worst, or all of them when it
// holds no row past its last place.
let placed = (i: number, limit: number, sorting: boolean): Select =>
  select({
    cols: candidate(col('owner'), col('rank'), i, 0),
    from: table(top(i)),
    where: sorting ? lit(true) : not(exists(select({
      cols: [lit(1)],
      from: table(edge(i)),
      where: and(full(i, limit), eq(col('rank', edge(i)), col('rank', top(i)))),
    }))),
  })

// Index `i`'s places at its worst rank when the row past its last place ties
// with them, taken again newest first: all who share that rank but the row
// past. Otherwise the scan's limit is 0, which SQLite stops at before reading
// a row. It matches the rank through `bm25`, since FTS5 reads a constraint on
// `rank` as its configuration.
let newest = (
  name: string,
  i: number,
  t: string,
  limit: number,
  admitted: Admitted,
): Select => {
  let fts = indexName(name)
  let worst = (value: Expr) =>
    sub(select({ cols: [value], from: table(edge(i)) }))
  let room = when(
    [[
      and(full(i, limit), op('>', col('n'), lit(1))),
      op('-', col('n'), lit(1)),
    ]],
    lit(0),
  )
  return select({
    cols: candidate(col('owner'), col('rank'), i, 0),
    from: from(
      select({
        cols: [as(col('rowid'), 'owner'), as(col('rank'), 'rank')],
        from: table(fts),
        where: and(
          eq(fn('bm25', col(fts)), worst(col('rank'))),
          admitted(name, t),
        ),
        order: [desc(col('rowid'))],
        limit: fn('coalesce', worst(room), lit(0)),
      }),
      '__newest',
    ),
  })
}

// Index `i`'s best `limit` admitted owners whose stored text, in any of its
// columns, is exactly `name`: the rows whose text begins with it (`^`), each
// read once to compare, and each ranked by the words `t` as a hit is. In an
// index of one column every such row says the same words in the same length,
// so all rank alike and the best are the newest: the scan stops at `limit`.
// In an index of several, the rest of a row moves its rank, so every name is
// ranked. A property kept elsewhere is compared as stored: a body @yaks/blob
// holds is its address, never its words.
let exactly = (
  { name: index, comp, props }: Index,
  i: number,
  t: string,
  name: string,
  limit: Expr,
  admitted: Admitted,
): Query => {
  let fts = indexName(index)
  let n = at('__named')
  let same = (p: string) =>
    eq(fn('lower', fn('trim', n(p))), fn('lower', val(name)))
  let rank = sub(select({
    cols: [col('rank', '__rank')],
    from: table(fts, '__rank'),
    where: and(
      op('match', col(fts, '__rank'), val(t)),
      eq(col('rowid', '__rank'), col('rowid', fts)),
    ),
  }))
  return select({
    cols: candidate(col('owner'), col('rank'), i, 1),
    from: from(
      select({
        cols: [as(col('rowid'), 'owner'), as(rank, 'rank')],
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
        order: [...props.length > 1 ? [col('rank')] : [], desc(col('rowid'))],
        limit,
      }),
      `__named${i}`,
    ),
  })
}

/** What {@link find} is asked beside its words: {@link SearchOpts} less the
 * screens and sources it reads off the file itself. */
export type FindOpts = Omit<SearchOpts, 'screens' | 'content'> & {
  // the reader's scope (@yaks/graph `scope`) and the vocabulary it is read
  // in: only text that reader may see is ranked (`screens`)
  scope?: BindOpts
  vocab?: Vocab
}

// The hits for a search, closest first. Returns [] for text containing no word
// and for a vocabulary with nothing indexed — a search that cannot be run finds
// nothing, rather than everything.
export let find = (
  db: Driver,
  fields: Field[],
  text: string,
  { scope, vocab, ...opts }: FindOpts = {},
): Hit[] => {
  if (scope && !vocab) throw new Error('a scoped search requires a vocabulary')
  let tables = catalogue(db).filter((o) => o.type == 'table')
  let content = Object.fromEntries(tables.flatMap((o) => {
    let source = /content='([^']*)'/.exec(o.sql ?? '')?.[1]
    return source ? [[o.name.replace(/_fts$/, ''), source]] : []
  }))
  // An index stands once its component's first write made it, and a scope
  // reads a component no table stands for as worn by nobody (@yaks/sqlite).
  let live = fields.filter((f) => (f.on ?? f.comp) in content)
  let stmt = hits(live, text, {
    plan: db.file ? 'sort' : 'index',
    content,
    ...scope && {
      screens: screens(live, vocab!, {
        ...scope,
        absent: absentFrom(vocab!, new Set(tables.map((o) => o.name))),
      }),
    },
    ...opts,
  })
  if (!stmt) return []
  return db.query(stmt).map((r) => ({
    entity: String(r.entity),
    rank: Number(r.rank),
    snippet: String(r.snippet ?? ''),
  }))
}
