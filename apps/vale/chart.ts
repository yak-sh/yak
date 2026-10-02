// A chart of the world, north up: the ground painted from the same numbers
// that grow it (terrain.ts), a pixel a column, what tops each in its region's
// colours, water by its depth, hills shaded as if lit from the north-west,
// what stands tall as a darker round, what is built in the colour of a roof,
// and a faint line where one region meets the next. Pure, so a worker paints
// the map's (grow.ts), and the page paints ground already grown.
import { paletteOf } from './ground.ts'
import { levelOf } from './levels.ts'
import { bulk, KINDS } from './props.ts'
import { clamp } from './rand.ts'
import {
  CHUNK,
  type Patch,
  patchOf,
  type Prop,
  vale,
  WATER,
} from './terrain.ts'

// What is built, seen from above.
let ROOF = 0xa9553a
// How tall a prop stands before the chart shows it, in metres.
let TALL = 1.2
// How deep water is before it is drawn at its deepest, in metres.
let DEPTH = 2.5

let bytes = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]

let painting = (
  x0: number,
  z0: number,
  size: number,
  m: number,
) => {
  let N = Math.round(size / m)
  let i0 = Math.round(x0 / m), k0 = Math.round(z0 / m)
  let px = new Uint8ClampedArray(N * N * 4)
  let put = (at: number, rgb: number[], k = 1) => {
    px[at * 4] = rgb[0] * k
    px[at * 4 + 1] = rgb[1] * k
    px[at * 4 + 2] = rgb[2] * k
    px[at * 4 + 3] = 255
  }
  // Decode each region's colours once. No arrays or palette lookups in the
  // column loop, where a region can appear tens of thousands of times.
  let palettes = new Map<string, {
    tops: Record<number, number[]>
    deep: number[]
    shallow: number[]
  }>()
  let colours = (id: string) => {
    let got = palettes.get(id)
    if (got) return got
    let pal = paletteOf(levelOf(id)!)
    got = {
      tops: Object.fromEntries(
        Object.entries(pal.tops).map(([top, hex]) => [top, bytes(hex)]),
      ),
      deep: bytes(pal.water[0]),
      shallow: bytes(pal.water[1]),
    }
    palettes.set(id, got)
    return got
  }
  let regions: string[] = []
  let patch = (p: Patch) => {
    let { ci, ck, voxel } = p, C = p.n - 2
    let pals = p.regions.map(colours)
    let heights = p.layers[0], n = p.n
    let ox = ci * CHUNK, oz = ck * CHUNK
    let west = Math.max(0, Math.round(ox / m) - i0)
    let east = Math.min(N, Math.round((ox + CHUNK) / m) - i0)
    let north = Math.max(0, Math.round(oz / m) - k0)
    let south = Math.min(N, Math.round((oz + CHUNK) / m) - k0)
    for (let dk = north; dk < south; dk++) {
      let pk = Math.min(C - 1, Math.floor(((k0 + dk + 0.5) * m - oz) / voxel))
      for (let di = west; di < east; di++) {
        let pi = Math.min(
          C - 1,
          Math.floor(((i0 + di + 0.5) * m - ox) / voxel),
        )
        let j = pi + pk * C, hj = pi + 1 + (pk + 1) * n
        let at = di + dk * N
        let h = Math.fround(heights[hj] * voxel), pal = pals[p.region[j]]
        let out = at * 4
        regions[at] = p.regions[p.region[j]]
        if (h <= WATER) {
          let d = clamp((WATER - h) / DEPTH, 0, 1)
          for (let c = 0; c < 3; c++) {
            px[out + c] = pal.shallow[c] + (pal.deep[c] - pal.shallow[c]) * d
          }
        } else {
          // Lit from the north-west: brighter where the ground rises to
          // the south-east. Round heights just as the former height
          // buffer did, including voxel sizes that are not binary exact.
          let rise = (
            Math.fround(heights[hj + 1] * voxel) -
            Math.fround(heights[hj - 1] * voxel) +
            Math.fround(heights[hj + n] * voxel) -
            Math.fround(heights[hj - n] * voxel)
          ) / (2 * voxel)
          let own = pal.tops[p.top[j]]
          let next = pals[p.other[j]].tops[p.top[j]]
          let s = 0.5 + p.share[j] / 510
          let light = clamp(1 + rise * 0.25, 0.72, 1.18)
          for (let c = 0; c < 3; c++) {
            px[out + c] = (own[c] * s + next[c] * (1 - s)) * light
          }
        }
        px[out + 3] = 255
      }
    }
  }
  let finish = (props: Iterable<Prop>) => {
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
      for (
        let k = Math.floor(z / m) - k0;
        k < Math.ceil((z + d) / m) - k0;
        k++
      ) {
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
    for (let p of props) {
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
    return px
  }
  return { patch, finish }
}

/** Regions under the fixed chart pixels, from the grown patch's columns. */
export let chartRegions = (p: Patch): Set<string> => {
  let ids = new Set<string>(), C = p.n - 2
  for (let z = 0; z < CHUNK; z++) {
    for (let x = 0; x < CHUNK; x++) {
      let i = Math.floor((x + 0.5) / p.voxel),
        k = Math.floor((z + 0.5) / p.voxel)
      ids.add(p.regions[p.region[i + k * C]])
    }
  }
  return ids
}

/** Paint already grown ground at one pixel per metre, at every map scale. */
export let chartPatch = (
  p: Patch,
  props: Prop[] = [],
): Uint8ClampedArray<ArrayBuffer> => {
  let paint = painting(p.ci * CHUNK, p.ck * CHUNK, CHUNK, 1)
  paint.patch(p)
  return paint.finish(props)
}

/** The world's chart over the square `size` metres on a side whose
 * north-west corner is (x0, z0), a pixel every `m` metres (a voxel edge that
 * divides CHUNK), as RGBA, `size / m` pixels on a side.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * import { spotOf } from './regions.ts'
 * import { seedDesigns } from './designs_fixture.ts'
 * seedDesigns()
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
  let v = vale(m), paint = painting(x0, z0, size, m)
  let i0 = Math.round(x0 / m), k0 = Math.round(z0 / m)
  let N = Math.round(size / m), C = CHUNK / m
  for (let ck = Math.floor(k0 / C); ck * C < k0 + N; ck++) {
    for (let ci = Math.floor(i0 / C); ci * C < i0 + N; ci++) {
      paint.patch(patchOf(v, ci, ck))
    }
  }
  let plants = function* () {
    for (let ck = Math.floor(z0 / CHUNK); ck * CHUNK < z0 + size; ck++) {
      for (let ci = Math.floor(x0 / CHUNK); ci * CHUNK < x0 + size; ci++) {
        yield* v.plant(ci, ck)
      }
    }
  }
  return paint.finish(plants())
}
