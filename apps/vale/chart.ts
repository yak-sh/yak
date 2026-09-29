// A chart of the world, north up: the ground painted from the same numbers
// that grow it (terrain.ts), a pixel a column, what tops each in its region's
// colours, water by its depth, hills shaded as if lit from the north-west,
// what stands tall as a darker round, what is built in the colour of a roof,
// and a faint line where one region meets the next. Pure, so a worker paints
// the map's (grow.ts) and a script paints the whole world.
import { paletteOf } from './ground.ts'
import { levelOf } from './levels.ts'
import { bulk, KINDS } from './props.ts'
import { clamp } from './rand.ts'
import { CHUNK, patchOf, vale, WATER } from './terrain.ts'

// What is built, seen from above.
let ROOF = 0xa9553a
// How tall a prop stands before the chart shows it, in metres.
let TALL = 1.2
// How deep water is before it is drawn at its deepest, in metres.
let DEPTH = 2.5

let bytes = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]

/** The world's chart over the square `size` metres on a side whose
 * north-west corner is (x0, z0), a pixel every `m` metres (a voxel edge that
 * divides CHUNK), as RGBA, `size / m` pixels on a side.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * import { spotOf } from './regions.ts'
 * let px = chart(0, 0, 128, 2)
 * let at = ([x, z]: [number, number]) => {
 *   let i = (Math.floor(x / 2) + Math.floor(z / 2) * 64) * 4
 *   return [px[i], px[i + 1], px[i + 2]]
 * }
 * let [r, g, b] = at(spotOf('mossvale', 'lake')!)
 * assert(b > r && b > g) // the lake is water
 * ;[r, g, b] = at(spotOf('mossvale', 'fields')!)
 * assert(g > b) // the fields are not
 * ```
 */
export let chart = (
  x0: number,
  z0: number,
  size: number,
  m: number,
): Uint8ClampedArray<ArrayBuffer> => {
  let v = vale(m), N = Math.round(size / m), C = CHUNK / m
  let i0 = Math.round(x0 / m), k0 = Math.round(z0 / m)
  let px = new Uint8ClampedArray(N * N * 4)
  // Column (i, k) of the chart: its patch, and its index there.
  let col = (i: number, k: number) => {
    let gi = i0 + i, gk = k0 + k
    let ci = Math.floor(gi / C), ck = Math.floor(gk / C)
    let p = patchOf(v, ci, ck)
    let di = gi - ci * C, dk = gk - ck * C
    return { p, j: di + dk * C, h: p.layers[0][di + 1 + (dk + 1) * p.n] * m }
  }
  let put = (at: number, rgb: number[], k = 1) => {
    px[at * 4] = rgb[0] * k
    px[at * 4 + 1] = rgb[1] * k
    px[at * 4 + 2] = rgb[2] * k
    px[at * 4 + 3] = 255
  }
  let hs = new Float32Array((N + 2) * (N + 2))
  for (let k = -1; k <= N; k++) {
    for (let i = -1; i <= N; i++) hs[i + 1 + (k + 1) * (N + 2)] = col(i, k).h
  }
  let H = (i: number, k: number) => hs[i + 1 + (k + 1) * (N + 2)]
  let regions: string[] = []
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      let { p, j } = col(i, k), h = H(i, k), at = i + k * N
      let id = p.regions[p.region[j]]
      let pal = paletteOf(levelOf(id)!)
      regions[at] = id
      if (h <= WATER) {
        let [deep, shallow] = pal.water.map(bytes)
        let d = clamp((WATER - h) / DEPTH, 0, 1)
        put(at, shallow.map((c, n) => c + (deep[n] - c) * d))
        continue
      }
      // Lit from the north-west: brighter where the ground rises to the
      // south-east.
      let rise = (H(i + 1, k) - H(i - 1, k) + H(i, k + 1) - H(i, k - 1)) /
        (2 * m)
      let own = bytes(pal.tops[p.top[j]])
      let s = 0.5 + p.share[j] / 510
      let next = bytes(
        paletteOf(levelOf(p.regions[p.other[j]])!).tops[p.top[j]],
      )
      put(
        at,
        own.map((c, n) => c * s + next[n] * (1 - s)),
        clamp(1 + rise * 0.25, 0.72, 1.18),
      )
    }
  }
  // Where a region meets the next, a line.
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      let at = i + k * N
      if (
        i + 1 < N && regions[at] != regions[at + 1] ||
        k + 1 < N && regions[at] != regions[at + N]
      ) put(at, [px[at * 4], px[at * 4 + 1], px[at * 4 + 2]], 0.8)
    }
  }
  // Every column in the rectangle `w` by `d` metres from (x, z).
  let cells = function* (x: number, z: number, w: number, d: number) {
    for (let k = Math.floor(z / m) - k0; k < Math.ceil((z + d) / m) - k0; k++) {
      for (
        let i = Math.floor(x / m) - i0;
        i < Math.ceil((x + w) / m) - i0;
        i++
      ) {
        if (i >= 0 && k >= 0 && i < N && k < N) yield [i, k]
      }
    }
  }
  let roof = bytes(ROOF)
  for (
    let ck = Math.floor(z0 / CHUNK);
    ck * CHUNK < z0 + size;
    ck++
  ) {
    for (
      let ci = Math.floor(x0 / CHUNK);
      ci * CHUNK < x0 + size;
      ci++
    ) {
      for (let p of v.plant(ci, ck)) {
        let span = KINDS[p.kind].span
        if (span) {
          let [w, d] = span
          for (let [i, k] of cells(p.x - w / 2, p.z - d / 2, w, d)) {
            put(i + k * N, roof)
          }
          continue
        }
        let { r, tall } = bulk(p.kind, p.seed)
        if (tall < TALL) continue
        for (let [i, k] of cells(p.x - r, p.z - r, 2 * r, 2 * r)) {
          let dx = (i0 + i + 0.5) * m - p.x, dz = (k0 + k + 0.5) * m - p.z
          if (dx * dx + dz * dz > r * r) continue
          let at = i + k * N
          // Darker, and darker still on the side away from the light.
          let dim = dx + dz > 0 ? 0.62 : 0.74
          put(at, [px[at * 4], px[at * 4 + 1], px[at * 4 + 2]], dim)
        }
      }
    }
  }
  return px
}
