// Exact cosine ordering over vectors, independent of their storage.
import { cosine } from './vector.ts'

export type Vector = { owner: number; vector: Float32Array | Int8Array }
export type Scored = { owner: number; similarity: number }

// Keep only the best `limit` scores. The root is the worst retained score;
// for equal scores, the higher owner id is worse, so a tie resolves the same
// way whichever vectors were read and in whatever order.
let worse = (a: Scored, b: Scored) =>
  a.similarity < b.similarity ||
  (a.similarity == b.similarity && a.owner > b.owner)

let push = (heap: Scored[], hit: Scored) => {
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

let replace = (heap: Scored[], hit: Scored) => {
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

/** The nearest vectors, bounded by count and similarity; ties keep the lower owner. */
export let scored = (
  query: Float32Array,
  vectors: Iterable<Vector>,
  { limit = 8, floor = 0, without }: {
    limit?: number
    floor?: number
    without?: number
  } = {},
): Scored[] => {
  if (limit <= 0) return []
  let heap: Scored[] = []
  for (let { owner, vector } of vectors) {
    if (owner == without) continue
    let hit = { owner, similarity: cosine(query, vector) }
    if (!(hit.similarity >= floor)) continue
    if (heap.length < limit) push(heap, hit)
    else if (worse(heap[0], hit)) replace(heap, hit)
  }
  return heap.sort((a, b) => b.similarity - a.similarity || a.owner - b.owner)
}
