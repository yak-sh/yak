// The query half: `.near=<entity>` becomes a condition, `.order=similar`
// becomes an ordering, and the similarity comes back as a component.
//
// A query mixes a neighbourhood with ordinary filters — `.near=cake-01
// .price<20` — and @yaks/query parses `.near` as a directive that @yaks/sql
// refuses on its own, because the vectors are here and not there. This module
// is the @yaks/sql extension that answers it, registered through
// `compile(ast, vocab, { extend: [semantic(db, embedder)] })`. It takes the
// embedder only for the vector space its model names, which is all a query
// needs of one.
//
// It compiles in three steps. The anchor's stored vector is read; the ranking
// returns the nearest entities; and that list becomes `owner in (?, ?, ?)` for
// the WHERE and a `case … when … then` for the ORDER BY. So the
// nearest-neighbor search itself runs where the vectors are — in this package —
// and what reaches SQL is a handful of integer ids, which is why the rest of
// the query still pages normally.
//
// Nearest among what the rest of the query selects. The ranking is cut down to
// `limit`, so cutting it before the other clauses filter would answer with the
// memories among the eight nearest entities of any kind — almost always none.
// @yaks/sql hands each extension the query's `Screen` (a statement selecting
// the eids the rest of the query admits) when it begins, and the scan reads
// only those vectors: filter, then rank, then cut.
//
// It remembers the neighbourhood the `.near` clause resolved, so the ordering
// can rank by it and the caller can read the scores back afterwards — and
// forgets it when the compiler reports that a new query has begun (@yaks/sql
// `Begin`). That is what lets a server register one of these when the plugin is
// composed and serve every query through it: each compilation answers from its
// own `.near`, and an `.order=similar` with none is refused as loudly as it was
// on the first query.

import type { Bundle } from '@yaks/graph'
import {
  among,
  type Expr,
  type Extension,
  FALSE,
  lit,
  type Screen,
  Unsupported,
  val,
  when,
} from '@yaks/sql'
import type { Driver } from '@yaks/sql'
import { type Near, nearest, type Rank, vectorOf } from './near.ts'

/** The `.order=` value that means "nearest first". */
export let SIMILAR = 'similar'

/** The name of the query-only component that carries the similarity back. */
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
 * neighbourhood it resolved, and the bundles with their scores attached.
 */
export type Semantic = Extension & {
  /** the neighbourhood the compiled `.near` selected, most similar first */
  neighbours: () => Near[]
  /** those bundles, nearest first, each carrying the query-only `rank` comp */
  rank: (bundles: Bundle[]) => Bundle[]
}

/**
 * A semantic query extension over a database's stored vectors.
 *
 * What it needs is the vector space, not the embedder: a `.near` anchor reads
 * the vector already stored for it and never calls the network, because
 * compiling a query is synchronous. Embedding text that has no entity yet is
 * the sweep's job — which is why a server whose embedder is still waiting for a
 * key ranks perfectly well over the vectors it already has.
 */
export let semantic = (
  db: Driver,
  space: { model: string },
  opts: SemanticOpts = {},
): Semantic => {
  let held: Near[] | null = null
  // What the rest of this query selects — not asked for until a `.near` needs
  // it.
  let asked: Screen | null = null
  let rank: Rank = opts.rank ??
    ((query, limit, within) =>
      nearest(db, query, { model: space.model, limit, within }))

  let near = (anchor: string, owner: Expr): Expr => {
    let vec = vectorOf(db, anchor, space.model)
    let limit = opts.limit ?? 8
    let within = asked?.() ?? undefined
    // An anchor with no vector has no neighbourhood, and compiling that to a
    // constant false selects nothing rather than widening to everything.
    // The ranking is asked for one extra: the anchor scores 1 against itself
    // and would otherwise eat a place, and nothing is its own neighbour.
    held = vec
      ? rank(vec, limit + 1, within)
        .filter((n) => n.entity != anchor && n.similarity >= (opts.floor ?? 0))
        .slice(0, limit)
      : []
    if (!held.length) return FALSE
    return among(owner, held.map((n) => val(n.owner)))
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
      // order — and a case with no arms is not a statement.
      if (!held.length) return lit(null)
      // The neighbours are already in order, so their position is the sort key.
      return when(
        held.map((n, i) => [lit(n.owner), lit(i)]),
        lit(held.length),
        site.owner,
      )
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
