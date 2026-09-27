// The search itself: a vector in, the nearest entities out.
//
// The ranking is an exact scan — every stored vector in the model's space is
// read, scored by cosine, and sorted. Exact means no recall to tune and no
// index to keep true, and at a few tens of thousands of vectors it costs a few
// milliseconds. A corpus past that wants an approximate index, and this is the
// one function to replace: {@link Rank} is its shape, and the query extension
// takes one, so an ANN swaps in without touching anything else here.
//
// A {@link Screen} is the other half of "nearest": nearest among what. The
// eight nearest entities of any kind are the wrong eight for `.near=X&.memory`
// — intersecting them with "and a memory" usually leaves nothing — so the rest
// of the query comes in as a statement selecting the eids it admits, the scan
// reads only those vectors, and the cut to `limit` happens after. Filter, then
// rank, then cut.
//
// A neighbour carries its integer owner id beside its eid for SQL ranking.

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
  join,
  lit,
  not,
  type Raw,
  select,
  table,
  val,
} from '@yaks/sql'
import { TABLE } from './ddl.ts'
import { cosine, unpack } from './vector.ts'

/**
 * One semantic neighbour: the entity, the integer id its rows key on, and how
 * similar it is (1 identical, 0 unrelated).
 */
export type Near = { entity: Eid; owner: number; similarity: number }

/**
 * A statement selecting the eids a neighbour must be among — what @yaks/sql
 * compiled for the rest of the query, passed straight in (the same interface
 * @yaks/fts's `find` takes as its `screen`).
 */
export type Screen = Raw

/**
 * A ranking: the nearest `limit` entities to a query vector, most similar
 * first, among the eids `within` allows. {@link nearest} is the exact one; an
 * approximate index has the same type, and one that cannot honour `within`
 * returns the wrong neighbourhood for every query that also filters.
 */
export type Rank = (
  query: Float32Array,
  limit: number,
  within?: Screen,
) => Near[]

// Every vector in one model's space whose entity still exists. Deleted entities
// are excluded here as well as pruned by the sweep: a delete between two sweeps
// must not leave a neighbour that no longer exists.
let e = at('e')
let o = at('o')
let vectors = (db: Driver, model: string, within?: Screen) => {
  let rows = db.query(select({
    cols: [as(e('entity'), 'owner'), as(e('vec'), 'vec')],
    from: table(TABLE, 'e'),
    joins: [join(table('entity', 'o'), eq(o('id'), e('entity')))],
    where: and(
      eq(e('model'), val(model)),
      not(exists(select({
        cols: [lit(1)],
        from: table('tombstone', 't'),
        where: eq(col('entity', 't'), e('entity')),
      }))),
      ...(within ? [among(o('eid'), within)] : []),
    ),
  }))
  return rows
}

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
  let row = db.query(select({
    cols: [as(e('vec'), 'vec')],
    from: table(TABLE, 'e'),
    joins: [join(table('entity', 'o'), eq(o('id'), e('entity')))],
    where: and(eq(o('eid'), val(entity)), eq(e('model'), val(model))),
  }))[0]
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
  /** the eids a neighbour must be among — what the rest of the query selects */
  within?: Screen
}

// Keep only the best `limit` scores. The root is the worst retained score;
// for equal scores, a later row is worse (matching stable sort over the scan).
type Hit = { owner: number; similarity: number; order: number }
let worse = (a: Hit, b: Hit) =>
  a.similarity < b.similarity ||
  (a.similarity == b.similarity && a.order > b.order)

let push = (heap: Hit[], hit: Hit) => {
  let i = heap.length
  heap.push(hit)
  while (i) {
    let p = (i - 1) >> 1
    if (!worse(hit, heap[p])) break
    heap[i] = heap[p]
    i = p
  }
  heap[i] = hit
}

let replace = (heap: Hit[], hit: Hit) => {
  let i = 0
  while (2 * i + 1 < heap.length) {
    let child = 2 * i + 1
    if (child + 1 < heap.length && worse(heap[child + 1], heap[child])) {
      child++
    }
    if (!worse(heap[child], hit)) break
    heap[i] = heap[child]
    i = child
  }
  heap[i] = hit
}

/** The entities nearest a query vector, most similar first. */
export let nearest = (
  db: Driver,
  query: Float32Array,
  opts: NearOpts,
): Near[] => {
  let limit = opts.limit ?? 8
  if (limit <= 0) return []
  let floor = opts.floor ?? 0
  let heap: Hit[] = []
  let without = opts.without && db.query(select({
    cols: [col('id')],
    from: table('entity'),
    where: eq(col('eid'), val(opts.without)),
  }))[0]?.id
  let order = 0
  for (let row of vectors(db, opts.model, opts.within)) {
    let index = order++
    if (row.owner == without) continue
    let bytes = row.vec as Uint8Array
    // A driver may return a slice with an unaligned offset. A view avoids a
    // second copy for aligned blobs while retaining unpack's safe fallback.
    let vec = bytes.byteOffset % 4 == 0
      ? new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      : unpack(bytes)
    let similarity = cosine(query, vec)
    if (
      !(similarity >= floor) ||
      (heap.length == limit && similarity <= heap[0].similarity)
    ) continue
    let hit = {
      owner: Number(row.owner),
      similarity,
      order: index,
    }
    if (heap.length < limit) push(heap, hit)
    else replace(heap, hit)
  }
  let owners = heap.map((h) => h.owner)
  if (!owners.length) return []
  let eids = new Map(
    db.query(select({
      cols: [col('id'), col('eid')],
      from: table('entity'),
      where: among(col('id'), owners.map((id) => val(id))),
    })).map((r) => [Number(r.id), String(r.eid)]),
  )
  return heap.sort((a, b) => b.similarity - a.similarity || a.order - b.order)
    .map(({ owner, similarity }) => ({
      entity: eids.get(owner)!,
      owner,
      similarity,
    }))
}
