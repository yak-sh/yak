// The query half: `.near=<entity>` becomes a condition, `.order=similar`
// becomes an ordering, and the similarity comes back as a component.
//
// A query line mixes a neighbourhood with ordinary filters — `.near=cake-01
// .price<20` — and @yaks/query parses `.near` as a directive @yaks/sql declines
// on its own, because the vectors are here and not there. This module is the
// @yaks/sql EXTENSION that answers it, registered through
// `compile(ast, vocab, { extend: [semantic(db, embedder)] })` — the embedder
// for the space its model NAMES, which is all a query needs of one.
//
// It compiles in three moves. The anchor's stored vector is read; the ranking
// answers the nearest entities; and that list becomes `owner in (?, ?, ?)` for
// the WHERE and a `case … when … then` for the ORDER BY. So the KNN itself runs
// where the vectors are — in this package — and what reaches SQL is a handful
// of integer ids, which is why the ordering needs no bound param (the IR's
// ORDER BY carries none) and why the rest of the query line still pages
// normally.
//
// NEAREST AMONG WHAT the rest of the line selects. The ranking is cut to
// `limit`, so cutting it before the other clauses filter answers the memories
// among the eight nearest entities of ANY kind — almost always none. @yaks/sql
// hands each extension the question's `Screen` (a statement over the eids the
// rest of the line admits) when it begins, and the scan reads only those
// vectors: filter, then rank, then cut.
//
// It remembers the neighbourhood the `.near` clause resolved so the ordering
// can rank by it and the caller can read the scores back afterwards — and
// forgets it when the compiler says a new question has begun (@yaks/sql
// `Begin`). That is what lets a HOST register one of these at compose time and
// serve every query through it: each compilation answers from its own `.near`,
// and an `.order=similar` with none declines as loudly as it did on the first
// query.

import type { Bundle } from '@yaks/graph'
import {
  type Cond,
  type Extension,
  FALSE,
  raw,
  type Screen,
  Unsupported,
} from '@yaks/sql'
import type { Driver } from './driver.ts'
import { type Near, nearest, type Rank, vectorOf } from './near.ts'

/** The `.order=` value that means "nearest first". */
export let SIMILAR = 'similar'

/** The name of the query-only component the similarity rides back on. */
export let RANK = 'rank'

/** How a `.near` neighbourhood is bounded. */
export type SemanticOpts = {
  /** how many neighbours the directive selects (default 8) */
  limit?: number
  /** the similarity a neighbour must reach to be selected at all (default 0) */
  floor?: number
  /** the ranking to use; the default is an exact scan over the stored vectors */
  rank?: Rank
}

/**
 * The @yaks/sql extension, plus the two things a caller wants back from it: the
 * neighbourhood it resolved, and the bundles wearing their scores.
 */
export type Semantic = Extension & {
  /** the neighbourhood the compiled `.near` selected, most similar first */
  neighbours: () => Near[]
  /** those bundles, nearest first, each wearing the query-only `rank` comp */
  rank: (bundles: Bundle[]) => Bundle[]
}

/**
 * A semantic query extension over a database's stored vectors.
 *
 * What it takes is the SPACE, not the embedder: a `.near` anchor reads the
 * vector already stored for it, never the network, because compiling a query
 * is synchronous. Embedding text that has no entity yet is the sweep's job —
 * which is why a host whose embedder is still waiting for a key ranks
 * perfectly well over what it has.
 */
export let semantic = (
  db: Driver,
  space: { model: string },
  opts: SemanticOpts = {},
): Semantic => {
  let held: Near[] | null = null
  // The rest of this question, unasked until a `.near` needs it.
  let asked: Screen | null = null
  let rank: Rank = opts.rank ??
    ((query, limit, within) =>
      nearest(db, query, { model: space.model, limit, within }))

  let near = (anchor: string, owner: string): Cond => {
    let vec = vectorOf(db, anchor, space.model)
    let limit = opts.limit ?? 8
    let within = asked?.() ?? undefined
    // An anchor with no vector has no neighbourhood, and saying so as a
    // constant false answers "nothing" rather than widening to everything.
    // The ranking is asked for one extra: the anchor scores 1 against itself
    // and would otherwise eat a place, and nothing is its own neighbour.
    held = vec
      ? rank(vec, limit + 1, within)
        .filter((n) => n.entity != anchor && n.similarity >= (opts.floor ?? 0))
        .slice(0, limit)
      : []
    if (!held.length) return FALSE
    return raw({
      sql: `${owner} in (${held.map(() => '?').join(', ')})`,
      params: held.map((n) => n.owner),
    })
  }

  return {
    name: 'embedding',
    begin: (screen) => {
      held = null
      asked = screen
    },
    compile: {
      near: (clause, site) =>
        clause.kind == 'near' ? near(clause.value, site.owner) : null,
    },
    order: (value, site) => {
      if (value != SIMILAR) return null
      if (!held) {
        throw new Unsupported(
          `.order=${SIMILAR}`,
          'nothing to rank by — it orders a .near neighbourhood',
          '@yaks/embedding',
        )
      }
      // An empty neighbourhood selects no rows, so there is nothing to put in
      // order — and a CASE with no arms is not a statement.
      if (!held.length) return 'null'
      // The neighbours are already in order, so their POSITION is the sort key.
      // Integer ids are the one value an ORDER BY can carry here, and they were
      // minted by the store rather than typed by anyone.
      let arms = held.map((n, i) => `when ${n.owner} then ${i}`).join(' ')
      return `case ${site.owner} ${arms} else ${held.length} end`
    },
    neighbours: () => held ?? [],
    rank: (bundles) => {
      let by = new Map((held ?? []).map((n) => [n.entity, n.similarity]))
      let score = (b: Bundle) => by.get(b.entity.eid) ?? -Infinity
      // A bundle the neighbourhood does not name keeps its shape and sorts
      // last: this decorates an answer, it never silently drops one.
      return [...bundles]
        .sort((a, b) => score(b) - score(a))
        .map((b) =>
          by.has(b.entity.eid) ? { ...b, [RANK]: { score: score(b) } } : b
        )
    },
  }
}
