// Reads: a query in, whole entities out. The compile half is the sibling
// packages' — @yaks/query parses the query text, @yaks/vocab describes the
// vocabulary, @yaks/sql compiles the two into a statement — and the per-
// component gather is @yaks/sqlite's `compSql`, so a column that the filter
// resolves one way cannot come back gathered another.
//
// What is this package's own is the SHAPE of the round trips. @yaks/sqlite asks
// one question at a time because an embedded engine answers in microseconds;
// over D1 every question is a network hop, so a gather that read one component
// at a time would cost a hop per component per entity. Here the whole gather —
// every entity's spine, every entity's components — is built as one list of
// statements and sent as a single `batch()`. A read of any size is two round
// trips: the compiled query, then the gather.
//
// TWO, because the second list has to BIND the eids the first found. When the
// hits do not need binding — when the query that found them can be named again
// as a subquery — the two collapse into one: `wholeSql` puts the query, the
// spine of what it hits and every component of it in a SINGLE batch, each
// statement saying `where o.eid in (<the query>)`. That is what @yaks/graph's
// `Tx.whole` asks for, and it is why an `about` read costs one trip and not
// two. The price is the filter evaluated once per component instead of once,
// which is why it is offered for a query naming a SET and not for `read`, where
// a `.limit` re-evaluated per statement could break a tie differently in each.

import { type And, parse } from '@yaks/query'
import type { BindOpts } from '@yaks/sql'
import { compile } from '@yaks/sql'
import { compSql, OWNER, setSql } from '@yaks/sqlite'
import type { Bundle, Comp, Entity } from '@yaks/graph'
import { tombstoned } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import type { Row, Sql } from './d1.ts'

/** A query, as text or as an already-built AST. Text is parsed; an AST passes
 * through, so a caller may hand-build one with @yaks/query's builders. */
export type Query = string | And

let ast = (q: Query): And => typeof q == 'string' ? parse(q) : q

/** The compiled statement for a query: SQL and its bound parameters. */
export let sql = (v: Vocab, query: Query, opts: BindOpts = {}): Sql => {
  let { sql, params } = compile(ast(query), v, opts)
  return { sql, params: params as Sql['params'] }
}

/** The identity of an eid, as stored: its `num`, and whether it is buried. One
 * statement, so a gather of many entities is one batch. */
export let spineSql = (eid: string): Sql => ({
  sql: `select e.num as num, t.entity as dead from entity e
          left join tombstone t on t.entity = e.id where e.eid = ?`,
  params: [eid],
})

/** What a gather asks about one entity: its spine, then one read per component
 * the vocabulary declares. The order is what {@link bundles} reads back. */
export let gatherSql = (v: Vocab, eid: string, opts: BindOpts = {}): Sql[] => [
  spineSql(eid),
  ...comps(v).map((comp) => ({
    sql: compSql(v, comp, opts.derived),
    params: [eid],
  })),
]

/** The components a gather reads, in the vocabulary's order — the spine is the
 * identity, not a component of its own. */
export let comps = (v: Vocab): string[] =>
  v.all.filter((name) => name != 'entity')

// One entity's answers, turned back into a bundle. The results arrive in the
// order `gatherSql` asked: the spine first, then a component per statement.
let bundleOf = (
  v: Vocab,
  eid: string,
  answers: Row[][],
): Bundle | undefined => {
  let spine = answers[0][0]
  if (!spine) return undefined
  let entity: Entity = {
    eid,
    ...(spine.num == null ? {} : { num: Number(spine.num) }),
  }
  if (spine.dead != null) return tombstoned(entity)
  let out: Bundle = { entity }
  comps(v).forEach((comp, i) => {
    let row = answers[i + 1][0]
    if (!row) return
    delete row.present
    out[comp] = row as Comp
  })
  return out
}

/**
 * Turn the answers to a gather back into bundles, one per eid, in the order the
 * eids were asked about. An eid no entity wears is simply absent; a tombstoned
 * one comes back wearing `tombstone` (it is still an identity, just a dead one).
 *
 * `answers` is the flat result list `batch()` returns for
 * `eids.flatMap(gatherSql)` — one entry per statement, in order.
 */
export let bundles = (v: Vocab, eids: string[], answers: Row[][]): Bundle[] => {
  let width = comps(v).length + 1
  return eids.flatMap((eid, i) => {
    let b = bundleOf(v, eid, answers.slice(i * width, (i + 1) * width))
    return b ? [b] : []
  })
}

/**
 * What a WHOLE read asks, as one batch: the compiled query first — it names the
 * hits and fixes their order — then the spine of everything it hits, then one
 * statement per component over that same set. Nothing binds an eid: each
 * statement says the query again as a subquery, which is what lets the answer
 * come back in a single round trip. {@link whole} reads it back.
 */
export let wholeSql = (v: Vocab, q: Sql, opts: BindOpts = {}): Sql[] => {
  let sub = `select "eid" from (${q.sql})`
  return [
    q,
    {
      sql: `select e.eid as eid, e.num as num, t.entity as dead from entity e
              left join tombstone t on t.entity = e.id
              where e.eid in (${sub})`,
      params: q.params,
    },
    ...comps(v).map((comp) => ({
      sql: setSql(v, comp, sub, opts.derived),
      params: q.params,
    })),
  ]
}

/**
 * Turn those answers back into bundles: the hits in the order the query named
 * them, each whole. Same shape as {@link bundles}, keyed by the owner column
 * each set-shaped statement carries rather than by position.
 */
export let whole = (v: Vocab, answers: Row[][]): Bundle[] => {
  let [hits, spines, ...parts] = answers
  let out = new Map<string, Bundle>()
  for (let r of spines) {
    let entity: Entity = {
      eid: String(r.eid),
      ...(r.num == null ? {} : { num: Number(r.num) }),
    }
    out.set(entity.eid, r.dead == null ? { entity } : tombstoned(entity))
  }
  comps(v).forEach((comp, i) => {
    for (let row of parts[i] ?? []) {
      let b = out.get(String(row[OWNER]))
      delete row[OWNER]
      delete row.present
      if (b && b.tombstone == null) b[comp] = row as Comp
    }
  })
  return hits.flatMap((r) => {
    let b = r.eid == null ? undefined : out.get(String(r.eid))
    return b ? [b] : []
  })
}
