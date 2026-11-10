// Ranked results, with a snippet.
//
// The extension (./compile.ts) decides membership — which entities a search
// selects. This module answers the other question a search box asks: of those,
// which come first, and what text matched? That is FTS5's `bm25` relevance and
// its `snippet()`, both of which can only be read in a statement that queries
// the index itself, so this module builds those statements and runs them.
//
// `hits()` runs them through a driver and returns {@link Hit}s; `find()` reads
// the indexes' sources off the file first. Ranking is by relevance alone;
// mixing in recency, popularity or anything else is an application's policy,
// applied to the results it gets back.

import type { Eid } from '@yaks/graph'
import {
  absentFrom,
  among,
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
  type Raw,
  type Select,
  select,
  type Selection,
  sourceScreen,
  sub,
  table,
  val,
  when,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import {
  type Field,
  type Index,
  indexes,
  indexName,
  trim,
  worded,
} from './fields.ts'
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
    indexes(worded(fields)).flatMap(({ name, comp, on }) => {
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

// An owner wearing none of `not`, the components whose wearers no word search
// finds (./fields.ts `unfound`): a seek per component, as the tombstone's is.
export let unworn = (comps: string[] = [], owner: Expr): Expr[] =>
  comps.map((comp) =>
    not(exists(select({
      cols: [lit(1)],
      from: table(comp, '__unfound'),
      where: eq(col('entity', '__unfound'), owner),
    })))
  )

// The ranked hits for a search, best first, or null when the text contains no
// word. The words are ANDed terms (./term.ts) and bm25 orders the results, so
// a search behaves as a set of words rather than as one phrase.
//
// The ranking is `best`; a snippet is read last, and only for the rows
// returned. FTS5 reads a row's text back to cut one, and a search over
// transcripts matches thousands of rows, some of them megabytes of command
// output: cutting a snippet for every match before choosing twenty took
// seconds where ranking alone takes milliseconds.
export let hits = (
  db: Driver,
  fields: Field[],
  text: string,
  opts: SearchOpts = {},
): Hit[] | null => {
  let ranking = best(db, fields, match(text), { name: named(text), ...opts })
  if (!ranking) return null
  if (!ranking.length) return []
  let context = opts.context ?? 10
  // Membership and rank still use the full match; the excerpt leaves common
  // terms unmarked, so FTS5 does less work cutting large matching texts.
  let marked = excerpt(text)
  let ids = (rows: Candidate[]) => rows.map((r) => lit(r.owner))
  // Each eid is read by id, a seek a row: asked as a set, SQLite may walk
  // `entity` whole however few the ids, whatever its statistics say.
  let o = at('__owner'), e = at('entity')
  let eids = new Map(
    db.query(select({
      cols: [
        as(o('column1'), 'id'),
        as(
          sub(select({
            cols: [e('eid')],
            from: table('entity'),
            where: eq(e('id'), o('column1')),
          })),
          'eid',
        ),
      ],
      from: from(
        { t: 'values', rows: ids(ranking).map((id) => [id]) },
        '__owner',
      ),
    })).map((r) => [Number(r.id), String(r.eid)]),
  )
  let snippets = new Map<string, string>()
  indexes(worded(fields)).forEach(({ name, props }, i) => {
    let mine = ranking.filter((r) => r.arm == i)
    if (!mine.length) return
    let fts = indexName(name)
    let cuts = db.query(select({
      cols: [
        as(col('rowid', fts), 'owner'),
        as(cut(fts, props, marked, context, opts.content?.[name]), 'snippet'),
      ],
      from: table(fts),
      where: and(
        op('match', col(fts), val(marked)),
        among(col('rowid', fts), ids(mine)),
      ),
    }))
    for (let r of cuts) snippets.set(`${i} ${r.owner}`, String(r.snippet ?? ''))
  })
  return ranking.flatMap((r) => {
    let entity = eids.get(r.owner)
    return entity == null ? [] : [{
      entity,
      rank: r.rank,
      snippet: snippets.get(`${r.arm} ${r.owner}`) ?? '',
    }]
  })
}

// The same ranking over a match expression already built from the words
// (term.ts), without snippets — what `.order=search` ranks by (./compile.ts):
// the entities' integer owners, best first.
export let ranked = (
  db: Driver,
  fields: Field[],
  t: string,
  opts: SearchOpts = {},
): number[] => (best(db, fields, t, opts) ?? []).map((r) => r.owner)

// A ranked entity: its integer owner, its bm25 rank, the index it ranked best
// in (`arm`), and whether its stored text is the words exactly (`named`).
type Candidate = { owner: number; rank: number; arm: number; named: number }

// The best `limit` entities, one row each. An entity's best rank is its
// `min` across indexes, and its arm the index that rank came from.
//
// The ranking runs as a statement a step, and each statement admits through
// one index's screen. Workerd's SQLite counts every naming of a common table
// expression, with each source its body reads, against its depth of 100, and
// a visibility screen reads dozens: measured on a Durable Object, 2026-11-10,
// one index's page under a screen counts 24, so four indexes' pages refused as
// one statement however they were written, and written out without CTEs they
// pass the engine's 100 KB. So each index's page, its tied places and its
// exact names are read alone, and what joins them (the edge of a page, an
// entity's best index, the order) is plain arithmetic here.
//
// A page stops reading at its best rows. Each index answers only its own best
// `limit` admitted rows (`page`), through FTS5's own `order by rank`, which
// sorts inside the index and hands back just the rows taken: a yaks.app store
// bills each row a cursor hands back, so a broad word costs a page, not every
// match. The best `limit` entities across indexes are among each index's best
// `limit`, so nothing is lost by cutting each first. Admission (the screen,
// visibility, a tombstone) is tested as the index hands rows back, so a row
// the rest of the query refuses never takes a place.
//
// Equal matches go newest first, as a listing does, but FTS5 hands equal ranks
// back oldest first. So an index-order page reads one row past its last place,
// and when that row ranks the same as the last place, the places at that rank
// are taken again, newest first, by a `rowid desc` scan of the rows ranking
// exactly that (`newest`). A CPU sort orders ties itself.
//
// A name comes first. bm25 rewards a word said often in a short text, so a
// task saying "Mossvale" twice in its title outranks the project whose title
// is the one word, which sat past a hundred others for `mossvale`. So the
// matches whose stored text is exactly the words, ignoring case (`exactly`),
// rank before every other. They are found through the index as rows whose
// text begins with the words (FTS5's `^`), and only those rows are read to
// compare.
let best = (
  db: Driver,
  fields: Field[],
  t: string,
  opts: SearchOpts,
): Candidate[] | null => {
  let arms = indexes(worded(fields))
  if (!t || !arms.length) return null
  let limit = opts.limit ?? 20
  let sorting = opts.plan == 'sort'
  // A screen the compiler made tests one owner by its keyed form, a seek per
  // posting however many owners it admits. A bare relation is read whole: a
  // CPU sort visits every matching posting, so it is read once a statement;
  // index-order pages keep candidate seeks for sparse paid reads.
  let probed = !!opts.screen?.probe
  let screen: Cte[] = opts.screen
    ? [{
      name: '__fts_screen',
      cols: ['id'],
      q: opts.screen,
      materialized: sorting && !probed,
    }]
    : []
  let ask = (q: Select, arm: number, named: 0 | 1): Candidate[] =>
    db.query({ ...q, with: screen }).map((r) => ({
      owner: Number(r.owner),
      rank: Number(r.rank),
      arm,
      named,
    }))
  let eligible = (owner: Expr) =>
    probed ? member(opts.screen!, owner) : exists(select({
      cols: [lit(1)],
      from: table('__fts_screen'),
      where: eq(col('id', '__fts_screen'), owner),
    }))
  // A kind can have no owners in an index at all. A CPU sort proves that
  // through the selected owners' component keys before opening its cursor.
  // Joined, not crossed: SQLite drives from the smaller side, so a broad
  // screen seeks a rare component's few owners rather than walking the graph
  // in id order to find one.
  let take = (arm: Index, n: number): Expr =>
    sorting && opts.screen
      ? when([[
        exists(select({
          cols: [lit(1)],
          from: table('__fts_screen'),
          joins: [join(
            table(arm.on ?? arm.comp, '__source'),
            eq(col('entity', '__source'), col('id', '__fts_screen')),
          )],
        })),
        lit(n),
      ]], lit(0))
      : lit(n)
  // An index's rows matching `expr`, among the live owners the caller admits.
  let admitted: Admitted = (name, expr) => {
    let fts = indexName(name)
    let owner = col('rowid', fts)
    return and(
      op('match', col(fts), val(expr)),
      permitted(name, owner, opts.screens),
      ...unworn(arms.find((arm) => arm.name == name)!.not, owner),
      ...opts.screen ? [eligible(owner)] : [],
      not(exists(select({
        cols: [lit(1)],
        from: table('tombstone', 't'),
        where: eq(col('entity', 't'), owner),
      }))),
    )
  }
  let found = arms.flatMap((arm, i) => {
    let { name } = arm
    let page = ask(
      select({
        cols: [as(col('rowid'), 'owner'), as(col('rank'), 'rank')],
        from: table(indexName(name)),
        where: admitted(name, t),
        order: [col('rank'), ...sorting ? [desc(col('rowid'))] : []],
        limit: take(arm, sorting ? limit : limit + 1),
      }),
      i,
      0,
    )
    let worst = page.at(-1)?.rank
    let tied = page.filter((r) => r.rank == worst).length
    let placed = page.length > limit
      ? [
        ...page.filter((r) => r.rank != worst),
        ...tied > 1
          ? ask(newest(name, t, worst!, tied - 1, admitted), i, 0)
          : [],
      ]
      : page
    let names = opts.name
      ? ask(exactly(arm, t, opts.name, take(arm, limit), admitted), i, 1)
      : []
    return [...placed, ...names]
  })
  let by = new Map<number, Candidate>()
  for (let c of found) {
    let held = by.get(c.owner)
    if (!held) by.set(c.owner, { ...c })
    else {
      if (c.rank < held.rank) Object.assign(held, { rank: c.rank, arm: c.arm })
      held.named = Math.max(held.named, c.named)
    }
  }
  return [...by.values()]
    .sort((a, b) => b.named - a.named || a.rank - b.rank || b.owner - a.owner)
    .slice(0, limit)
}

type Admitted = (name: string, expr: string) => Expr

// An index's places at its worst rank `worst` when the row past its last place
// ties with them, taken again newest first: `room` of them, all who share that
// rank but the row past. It matches the rank through `bm25`, since FTS5 reads
// a constraint on `rank` as its configuration.
let newest = (
  name: string,
  t: string,
  worst: number,
  room: number,
  admitted: Admitted,
): Select => {
  let fts = indexName(name)
  return select({
    cols: [as(col('rowid'), 'owner'), as(col('rank'), 'rank')],
    from: table(fts),
    where: and(eq(fn('bm25', col(fts)), val(worst)), admitted(name, t)),
    order: [desc(col('rowid'))],
    limit: lit(room),
  })
}

// An index's best `limit` admitted owners whose stored text, in any of its
// columns, is exactly `name`: the rows whose text begins with it (`^`), each
// read once to compare, and each ranked by the words `t` as a hit is. In an
// index of one column every such row says the same words in the same length,
// so all rank alike and the best are the newest: the scan stops at `limit`.
// In an index of several, the rest of a row moves its rank, so every name is
// ranked. A property kept elsewhere is compared as stored: a body @yaks/blob
// holds is its address, never its words.
let exactly = (
  { name: index, comp, props }: Index,
  t: string,
  name: string,
  limit: Expr,
  admitted: Admitted,
): Select => {
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
  let names = new Set(tables.map((o) => o.name))
  let live = fields.filter((f) => (f.on ?? f.comp) in content)
    .map((f) => trim(f, (comp) => names.has(comp)))
  return hits(db, live, text, {
    plan: db.file ? 'sort' : 'index',
    content,
    ...scope && {
      screens: screens(live, vocab!, {
        ...scope,
        absent: absentFrom(vocab!, names),
      }),
    },
    ...opts,
  }) ?? []
}
