// The vectors themselves: how one is stored, read back, and compared.
//
// A vector is a `Float32Array`. The store holds its raw bytes as a blob, so the
// dimension is the blob's byte length over four and no column has to carry it —
// and a vector from a different model, with a different dimension, is refused by
// arithmetic rather than by bookkeeping.
//
// Comparison is COSINE similarity: 1 identical, 0 unrelated, negative opposed.
// For unit-length vectors that is just the dot product, and everything stored
// here is normalized on the way in, so ranking a corpus is one multiply-add
// pass per vector.

/** A vector's raw bytes, for storing it as a blob. */
export let pack = (v: Float32Array): Uint8Array =>
  new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))

/**
 * A vector read back from its blob. The copy is deliberate: a `Float32Array`
 * needs a 4-byte-aligned buffer, and bytes handed back by a driver are aligned
 * only by luck.
 */
export let unpack = (bytes: Uint8Array): Float32Array =>
  new Float32Array(bytes.slice().buffer)

/**
 * The same direction at length 1. A zero vector has no direction, so it comes
 * back unchanged — {@link cosine} answers 0 against it, which is what "unrelated
 * to everything" should read as.
 */
export let unit = (v: Float32Array): Float32Array => {
  let sum = 0
  for (let x of v) sum += x * x
  let len = Math.sqrt(sum)
  if (!len) return v
  let out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / len
  return out
}

/**
 * Cosine similarity, 1 for the same direction and 0 for unrelated. Two vectors
 * of different lengths are from different spaces and score 0 — a model change
 * makes every old vector unrelated rather than subtly wrong.
 */
export let cosine = (a: Float32Array, b: Float32Array): number => {
  if (a.length != b.length) return 0
  let dot = 0, la = 0, lb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    la += a[i] * a[i]
    lb += b[i] * b[i]
  }
  let len = Math.sqrt(la) * Math.sqrt(lb)
  return len ? dot / len : 0
}
