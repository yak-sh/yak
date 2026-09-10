// Native similarity policy, composed with the package's semantic membership
// and storage read. Kept out of graph_query so hosted stores never import the
// native vector backend. No sweep or write runs on this path.
import { type Rank, semantic } from '@yaks/embedding'
import { and, every, near, order } from '@yaks/query'
import { raw } from '@yaks/sql'
import { rows } from '@yaks/sqlite'
import {
  eager,
  fleetVocabOf,
  locate,
  readDriver,
  referrersOf,
  rowsOf,
  textMatches,
} from './db.ts'
import { embed, FLOOR, MODEL, similar, stored, textOf } from './embed.ts'
import { rowed, walker } from './graph_query.ts'
import { matchQuery, NEAR, nearOf, type Pred, TEXT } from './query.ts'
import { where, whereSome } from './sql.ts'
import { toSql } from './relation.ts'
import type { Sql } from './store/sql.ts'

// The asynchronous provider is injected for offline contract tests. Production
// still uses hash-validated stored vectors and the indexed, eligibility-screened
// KNN, never @yaks/embedding's default full-vector scan.
export type Similarity = {
  model: string
  stored: typeof stored
  embed: typeof embed
  similar: typeof similar
}

export let similarRows = async (
  db: Sql,
  asked: Pred[],
  limit = 8,
  provider: Similarity = { model: MODEL, stored, embed, similar },
) => {
  let address = nearOf(asked)
  let eid = address ? locate(db, address) : undefined
  let c = eid ? rowsOf(db, [eid])[0]?.comps : undefined
  let text = eid
    ? textOf(c?.doc?.title, c?.doc?.body)
    : asked.filter((p) => p.op == TEXT).map((p) => p.value).join(' ')
  if (!text) return []
  let vec = eid ? provider.stored(db, eid, text) : null
  vec ??= await provider.embed(text)
  if (!vec) return []

  let driver = readDriver(db)
  let rank: Rank = (query, count) => {
    let found = provider.similar(db, query, count, FLOOR)
    // Package semantic orders by STORAGE owner, never entity.num. Resolve the
    // bounded KNN head together, not one lookup per neighbour.
    let owners = new Map(
      driver.query(
        'select eid, id from entity where eid in (select value from json_each(?))',
        [JSON.stringify(found.map((h) => h.eid))],
      )
        .map((r) => [String(r.eid), Number(r.id)]),
    )
    return found.filter((h) => owners.has(h.eid)).map((h) => ({
      entity: h.eid,
      owner: owners.get(h.eid)!,
      similarity: h.score,
    }))
  }
  // semantic() reads an anchor from a vector relation. Supply the request's
  // validated (or freshly embedded) vector as a read-only CTE view, NOT the
  // possibly stale sweep row. This also represents arbitrary query text with
  // no persistent entity. No fake entity/vector is written into the graph.
  let anchor = eid ?? '@fleet/query-text'
  let bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength)
  let ranked = semantic({
    query: (sql, params) =>
      driver.query(
        `with entity as (select 0 as id, ? as eid),
       embedding as (select 0 as entity, ? as model, ? as vec) ${sql}`,
        [anchor, provider.model, bytes, ...params],
      ),
    exec: () => {
      throw new Error('a similarity anchor is read-only')
    },
  }, {
    model: provider.model,
    embed: () => {
      throw new Error('semantic compilation never embeds')
    },
  }, { limit, floor: FLOOR, rank })
  let filters = asked.filter((p) => p.op != TEXT && p.op != NEAR)
  let exact = where(db, filters)
  let screen = toSql(exact ?? whereSome(db, filters))
  let selected = rows(
    {
      ...driver,
      // semantic's CASE embeds this neighbourhood's owner ids. Its SQL is
      // request-specific; do not retain each ranking in the statement cache.
      query: (sql, params) => db.prepare(sql).all(...params),
    },
    fleetVocabOf(db),
    and(near(anchor), every(), order('similar')),
    {
      extend: [ranked, {
        name: 'fleet/similarity-screen',
        compile: {
          every: () =>
            raw({
              sql: `"entity"."eid" in (${screen.sql})`,
              params: screen.params,
            }),
        },
      }],
    },
  )
  let by = new Map(
    rowsOf(db, selected.map((r) => String(r.eid)))
      .map((r) => [r.eid, r]),
  )
  let scores = new Map(ranked.neighbours().map((n) => [n.entity, n.similarity]))
  let ent = (eid: string) => by.get(eid)?.comps ?? eager(db, eid)
  let kids = (eid: string, comp: string, prop: string) =>
    referrersOf(db, [eid], { comp, prop }).map(ent)
  let walk = walker(db)
  return selected.flatMap((h) => {
    let r = by.get(String(h.eid))
    if (
      !r || !exact && !matchQuery(
          r.comps,
          filters,
          ent,
          undefined,
          kids,
          walk,
          (eid, pred) => textMatches(db, eid, pred),
        )
    ) return []
    let row = rowed(r)
    row.comps.rank = {
      score: scores.get(r.eid)!,
      open: r.eid,
      title: String(row.comps.doc?.title ?? ''),
    }
    return [row]
  })
}
