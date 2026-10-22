// The query half: a bare word in a query compiles to an FTS5 match.
//
// A query mixes words and filters — `hobbit .book.price<20` — and @yaks/query parses
// each bare word as a `text` clause. @yaks/sql compiles every clause except
// that one; this module is the @yaks/sql extension that compiles it, registered
// through `compile(ast, vocab, { extend: [search(fields)] })`.
//
// One clause is one word, or one run somebody quoted (@yaks/query splits on
// whitespace), so `term` converts it — a word matches as a prefix, a quoted run
// stays a phrase — and several words are ANDed together the way every other
// clause is.
//
// The generated condition is one `in` subquery per indexed component, ORed
// together: an index's rowid is the entity's integer id in the `entity` table,
// so a match yields ids the surrounding statement already uses, and no join is
// needed. The AND between words comes from how @yaks/sql combines clauses, not
// from this file.
//
// `.order=search` ranks what the words selected by relevance, closest first
// (`.order=-search` the weakest first). bm25 can only be read in a statement
// that matches the index, and an ORDER BY term re-matching per row costs a
// whole search per row, so the ranking runs once, through the server's own
// connection, among the rows the rest of the query admits (./search.ts). The
// order is then each entity's place in it, spelled over integer ids: the one
// value an ORDER BY here can carry. A window of a query with words that states
// no order is ranked the same way (`ranks`): a page of a search is its best
// rows, as a search box's are, never its newest. A search composed without a
// connection selects but does not rank.

import {
  among,
  and,
  col,
  type Driver,
  type Extension,
  FALSE,
  lit,
  lookup,
  op,
  or,
  type Raw,
  type Screen,
  select,
  type Source,
  table,
  Unsupported,
  val,
} from '@yaks/sql'
import { permitted, ranked, screens } from './search.ts'
import { type Field, indexes, indexName } from './fields.ts'
import { named, term } from './term.ts'
import type { Clause } from '@yaks/query/core'

// The ranking `.order=` names.
export let SEARCH = 'search'

// How many of the best matches `.order=search` puts in order; any past them
// follow, newest first.
export let RANKED = 1000

// MATCH opens a cursor per keyed candidate. Keep seeks to a handful of owners;
// larger screens retain the single walk through a term's postings.
let FEW = 4

// Whether a clause searches for a word among the rows it selects: a text
// clause with a word in it, alone or in a group (not a walk's, whose words
// are about other entities).
let worded = (c: Clause): boolean =>
  c.kind == 'text'
    ? !!term(c.value)
    : (c.kind == 'and' || c.kind == 'or') && c.clauses.some(worded)

// The @yaks/sql extension that resolves bare words against the search indexes.
// It handles the `text` clause, covering every indexed field, and orders by
// relevance to those words. Without this extension @yaks/sql rejects bare
// words rather than assuming an index exists.
export let search = (fields: Field[], db?: Driver): Extension => {
  // The words this query searched for (as terms, and as typed), and what the
  // rest of it selects, remembered for its `.order=search`.
  let words: string[] = []
  let said: string[] = []
  let asked: Screen | null = null
  // The owners in relevance order, resolved once a query.
  let held: number[] | null = null
  let sources: ReturnType<typeof screens> = {}
  let membership = new Map<Screen, Raw | null>()
  let shared = new Map<Screen, Source>()
  let rank = (): number[] => {
    if (held) return held
    let stmt = ranked(fields, words.join(' '), {
      screen: asked?.() ?? undefined,
      screens: sources,
      limit: RANKED,
      name: named(said.join(' ')),
    })
    held = stmt ? db!.query(stmt).map((r) => Number(r.owner)) : []
    return held
  }
  return {
    name: 'fts',
    begin: (screen) => {
      words = []
      said = []
      asked = screen
      held = null
      sources = {}
      membership.clear()
      shared.clear()
    },
    compile: {
      text: (clause, site) => {
        if (clause.kind != 'text') return null
        let t = term(clause.value)
        // A search containing no word matches nothing. Compiling it to a
        // constant false keeps the query away from the index rather than
        // widening the result set.
        if (!t) return FALSE
        // A screen compiled for another extension reads this clause again.
        if (!words.includes(t)) {
          words.push(t)
          said.push(clause.value)
        }
        sources = screens(fields, site.vocab, { visibility: site.visibility })
        let screen = site.screen
        let allowed: Source | undefined
        if (screen?.maximum != null && screen.maximum <= FEW) {
          if (!membership.has(screen)) membership.set(screen, screen())
          let within = membership.get(screen)
          if (within) {
            allowed = shared.get(screen)
            if (!allowed) shared.set(screen, allowed = site.share(within))
          }
        }
        return or(
          ...indexes(fields).map(({ name }) => {
            let fts = indexName(name)
            return among(
              site.owner,
              select({
                cols: [col('rowid')],
                from: table(fts),
                where: and(
                  op('match', col(fts), val(t)),
                  permitted(name, col('rowid', fts), sources),
                  ...allowed
                    ? [among(
                      col('rowid', fts),
                      select({ cols: [col('id')], from: allowed }),
                    )]
                    : [],
                ),
              }),
            )
          }),
        )
      },
    },
    // A window of a query with words in it is a search's best rows unless it
    // says otherwise, where there is a connection to rank through.
    ranks: (q) => db && worded(q) ? SEARCH : null,
    order: (value, site) => {
      if (value != SEARCH) return null
      if (!words.length || !db) {
        throw new Unsupported(
          `.order=${SEARCH}`,
          db
            ? 'nothing to rank by — it orders the words of a text search'
            : 'a search composed without a connection does not rank',
          '@yaks/fts',
        )
      }
      let ids = rank()
      // No match selects no rows, so there is nothing to put in order.
      if (!ids.length) return lit(null)
      // Site.owner is this row's stable integer id, including cursor anchors.
      return lookup(
        site.owner,
        ids.map((id, i) => [id, lit(i)]),
        { stable: true },
        lit(ids.length),
      )
    },
  }
}
