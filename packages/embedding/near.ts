// The search itself: a vector in, the nearest entities out.
//
// The ranking is an exact scan — every stored vector in the model's space is
// read, scored by cosine, and sorted. Exact means no recall to tune and no
// index to keep true, and at a few tens of thousands of vectors it costs a few
// milliseconds. A corpus past that wants an approximate index, and this is the
// one function to replace: {@link Rank} is its shape, and the query extension
// takes one, so an ANN swaps in without touching anything else here.
//
// A neighbour carries its integer owner id beside its eid. That is not leakage
// for its own sake: the ranking has to become SQL, and an integer id is the one
// thing an ORDER BY can carry safely without a bound param.

import type { Eid } from '@yaks/graph'
import type { Driver } from './driver.ts'
import { TABLE } from './ddl.ts'
import { q } from './fields.ts'
import { cosine, unpack } from './vector.ts'

/**
 * One semantic neighbour: the entity, the integer id its rows key on, and how
 * similar it is (1 identical, 0 unrelated).
 */
export type Near = { entity: Eid; owner: number; similarity: number }

/**
 * A ranking: the nearest `limit` entities to a query vector, most similar
 * first. {@link nearest} is the exact one; an approximate index has the same
 * shape.
 */
export type Rank = (query: Float32Array, limit: number) => Near[]

// Every living vector in one model's space. The graves are screened here as
// well as pruned by the sweep: a delete between two sweeps must not leave a
// neighbour that no longer exists.
let vectors = (db: Driver, model: string) =>
  db.query(
    `select e.entity as owner, o.eid as eid, e.vec as vec from ${q(TABLE)} e` +
      ` join entity o on o.id = e.entity` +
      ` where e.model = ?` +
      ` and not exists (select 1 from tombstone t where t.entity = e.entity)`,
    [model],
  ) as unknown as { owner: number; eid: Eid; vec: Uint8Array }[]

/**
 * The vector stored for an entity under a model, or null when it has none —
 * because it holds no text, because the sweep has not reached it, or because
 * the model moved and its row belongs to the old space.
 */
export let vectorOf = (
  db: Driver,
  entity: Eid,
  model: string,
): Float32Array | null => {
  let row = db.query(
    `select e.vec as vec from ${q(TABLE)} e join entity o on o.id = e.entity` +
      ` where o.eid = ? and e.model = ?`,
    [entity, model],
  )[0]
  return row ? unpack(row.vec as Uint8Array) : null
}

/** How a search is narrowed beyond "the nearest few". */
export type NearOpts = {
  /** the model whose space to search — the one the vectors were stored under */
  model: string
  /** how many neighbours at most (default 8) */
  limit?: number
  /** the similarity a neighbour must reach to count at all (default 0) */
  floor?: number
  /** an entity to leave out — nothing is its own neighbour */
  without?: Eid
}

/**
 * The entities nearest a query vector, most similar first. An exact cosine scan
 * over the model's stored vectors; see the note at the top of this file about
 * when to replace it.
 */
export let nearest = (
  db: Driver,
  query: Float32Array,
  opts: NearOpts,
): Near[] => {
  let floor = opts.floor ?? 0
  return vectors(db, opts.model)
    .filter((r) => r.eid != opts.without)
    .map((r) => ({
      entity: r.eid,
      owner: Number(r.owner),
      similarity: cosine(query, unpack(r.vec)),
    }))
    .filter((n) => n.similarity >= floor)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, opts.limit ?? 8)
}
