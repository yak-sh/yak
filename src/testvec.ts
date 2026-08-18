// Test-only fixtures: map a few axis coordinates to a DIM-dimensional UNIT
// vector whose pairwise cosines equal the coordinates' cosines — but with the
// energy SPREAD across every dimension, the way a real embedding sits. The
// vector extension's TURBO4 quantization is trained for dense vectors; a sparse
// fixture (energy in 2 of 384 dims) quantizes with large error and would make
// KNN tests lie. Riding the coordinates on a dense orthonormal basis keeps a
// terse `axes(1, 0)` fixture behaving like the real thing.

import { DIM } from './vector.ts'

// DCT-II basis rows are orthogonal and dense; normalize each to orthoNORMAL, so
// a linear combination's cosine is exactly the coordinates' cosine.
let basis = (k: number) => {
  let b = new Float32Array(DIM)
  for (let i = 0; i < DIM; i++) {
    b[i] = Math.cos((Math.PI * (i + 0.5) * (k + 1)) / DIM)
  }
  let n = Math.hypot(...b)
  for (let i = 0; i < DIM; i++) b[i] /= n
  return b
}
let B = Array.from({ length: 8 }, (_, k) => basis(k))

// axes(x0, x1, …): the unit vector x0·B0 + x1·B1 + … normalized. cosine between
// two such vectors equals the cosine of their coordinate tuples, so the old
// 2-D `vec(1, 0)` fixtures keep their exact geometry at full dimensionality.
export let axes = (...xs: number[]): Float32Array => {
  let v = new Float32Array(DIM)
  for (let k = 0; k < xs.length; k++) {
    let b = B[k]
    for (let i = 0; i < DIM; i++) v[i] += xs[k] * b[i]
  }
  let n = Math.hypot(...v)
  if (n) { for (let i = 0; i < DIM; i++) v[i] /= n }
  return v
}
