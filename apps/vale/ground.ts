// The ground as triangles, one chunk at a time. A column's top is a quad, and
// each side it shows above a lower neighbour is a quad per layer (a green
// band, then earth, then stone). Flat, open tops of one height and one kind
// merge into larger quads; the soft material still draws each voxel, because
// it tints them by their cell (soft.ts), so a merge costs nothing you can see.
import { type Out, quad, rgb, type Vec } from './mesh.ts'
import { N, Top, V, type Vale } from './terrain.ts'

/** Columns along a chunk's side. */
export let CHUNK = 32

let TOPS: Record<number, number> = {
  [Top.grass]: 0x8cc85c,
  [Top.lush]: 0x5fa24a,
  [Top.dry]: 0xb9bd66,
  [Top.sand]: 0xe8d69c,
  [Top.stone]: 0xa19f96,
  [Top.path]: 0xd2aa70,
  [Top.snow]: 0xf3f5f8,
}

// What shows on a column's sides: its top layer, then what lies beneath.
let BAND: Record<number, number> = {
  ...TOPS,
  [Top.grass]: 0x7db653,
  [Top.lush]: 0x55933f,
  [Top.dry]: 0xa7ab5a,
}
let EARTH: Record<number, number> = {
  [Top.grass]: 0x9c6d47,
  [Top.lush]: 0x8a6040,
  [Top.dry]: 0xa27a4f,
  [Top.sand]: 0xdcc58a,
  [Top.stone]: 0x8f8d85,
  [Top.path]: 0x9c6d47,
  [Top.snow]: 0x9a988f,
}
let STONE = 0x8a8983

// A colour, drifted by the column's hue: lusher or drier by a little.
let drift = (hex: number, hue: number): Vec => {
  let [r, g, b] = rgb(hex)
  let d = (hue - 0.5) * 0.22
  return [r * (1 - d * 0.6), g * (1 + d * 0.25), b * (1 - d)]
}

/** Write chunk (ci, ck)'s ground into `o`. */
export let groundChunk = (v: Vale, ci: number, ck: number, o: Out) => {
  let at = (i: number, k: number) =>
    Math.max(0, Math.min(N - 1, i)) + Math.max(0, Math.min(N - 1, k)) * N
  let H = (i: number, k: number) => v.h[at(i, k)]
  let i0 = ci * CHUNK, k0 = ck * CHUNK
  let round = V * 0.16

  // Tops. A column is merged with its neighbours when nothing about it needs
  // a corner of its own: no edge to round, no shade in a corner.
  let merge = new Int32Array(CHUNK * CHUNK).fill(-1)
  let single: [number, number][] = []
  for (let dk = 0; dk < CHUNK; dk++) {
    for (let di = 0; di < CHUNK; di++) {
      let i = i0 + di, k = k0 + dk, h = H(i, k)
      let open = H(i - 1, k) >= h && H(i + 1, k) >= h && H(i, k - 1) >= h &&
        H(i, k + 1) >= h
      let shaded = H(i - 1, k) > h || H(i + 1, k) > h || H(i, k - 1) > h ||
        H(i, k + 1) > h || H(i - 1, k - 1) > h || H(i + 1, k - 1) > h ||
        H(i - 1, k + 1) > h || H(i + 1, k + 1) > h
      if (open && !shaded) merge[di + dk * CHUNK] = h * 8 + v.top[at(i, k)]
      else single.push([i, k])
    }
  }
  let colour = (i: number, k: number) =>
    drift(TOPS[v.top[at(i, k)]], v.hue[at(i, k)])
  let done = new Uint8Array(CHUNK * CHUNK)
  for (let dk = 0; dk < CHUNK; dk++) {
    for (let di = 0; di < CHUNK; di++) {
      let key = merge[di + dk * CHUNK]
      if (key < 0 || done[di + dk * CHUNK]) continue
      let w = 1
      while (
        di + w < CHUNK && merge[di + w + dk * CHUNK] == key &&
        !done[di + w + dk * CHUNK]
      ) w++
      let d = 1
      grow: while (dk + d < CHUNK) {
        for (let x = 0; x < w; x++) {
          let j = di + x + (dk + d) * CHUNK
          if (merge[j] != key || done[j]) break grow
        }
        d++
      }
      for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) done[di + x + (dk + z) * CHUNK] = 1
      }
      let i = i0 + di, k = k0 + dk, h = H(i, k)
      let c = [
        ...colour(i, k),
        ...colour(i + w - 1, k),
        ...colour(i + w - 1, k + d - 1),
        ...colour(i, k + d - 1),
      ]
      quad(o, [i * V, h * V, k * V], 1, w * V, d * V, 1, c, [0, 0, 0, 0], round)
    }
  }
  for (let [i, k] of single) {
    let h = H(i, k)
    let up = (a: number, b: number) => H(a, b) > h ? 1 : 0
    // Ambient occlusion: a corner shaded by the columns that rise around it.
    let ao = (si: number, sk: number) => {
      let s1 = up(i + si, k), s2 = up(i, k + sk)
      return s1 && s2 ? 0 : 3 - (s1 + s2 + up(i + si, k + sk))
    }
    let c = colour(i, k)
    let rim: [number, number, number, number] = [
      H(i - 1, k) < h ? 1 : 0,
      H(i + 1, k) < h ? 1 : 0,
      H(i, k - 1) < h ? 1 : 0,
      H(i, k + 1) < h ? 1 : 0,
    ]
    quad(
      o,
      [i * V, h * V, k * V],
      1,
      V,
      V,
      1,
      [...c, ...c, ...c, ...c],
      rim,
      round,
      [ao(-1, -1), ao(1, -1), ao(1, 1), ao(-1, 1)],
    )
  }

  // Sides: what a column shows above each lower neighbour, one quad per layer.
  let SIDES: [number, number, number, number][] = [
    [-1, 0, 0, -1],
    [1, 0, 0, 1],
    [0, -1, 2, -1],
    [0, 1, 2, 1],
  ]
  for (let dk = 0; dk < CHUNK; dk++) {
    for (let di = 0; di < CHUNK; di++) {
      let i = i0 + di, k = k0 + dk, h = H(i, k), t = v.top[at(i, k)]
      for (let [si, sk, axis, sign] of SIDES) {
        let nh = H(i + si, k + sk)
        if (nh >= h) continue
        let hue = v.hue[at(i, k)]
        let layers: [number, number, number][] = [
          [h - 1, h, BAND[t]],
          [h - 4, h - 1, EARTH[t]],
          [-99, h - 4, STONE],
        ]
        // The two columns beside this face, along it: a corner is rounded
        // where the one past it is lower still.
        let [ai, ak] = axis == 0 ? [0, 1] : [1, 0]
        for (let [y0, y1, hex] of layers) {
          let lo = Math.max(y0, nh), hi = y1
          if (hi <= lo) continue
          let c = drift(hex, hue)
          let base = [c[0], c[1], c[2]]
          // Darker toward the foot of a wall, where the lower ground meets it.
          let foot = lo == nh ? 0.72 : 1
          let cs = [
            ...base.map((x) => x * foot),
            ...base.map((x) => x * foot),
            ...base,
            ...base,
          ]
          let before = H(i - ai, k - ak) <= lo ? 1 : 0
          let after = H(i + ai, k + ak) <= lo ? 1 : 0
          let x = axis == 0 ? (sign > 0 ? i + 1 : i) : i
          let z = axis == 2 ? (sign > 0 ? k + 1 : k) : k
          // Axis x faces run along z then y; axis z faces along x then y.
          let du = V, dv = (hi - lo) * V
          let rim: [number, number, number, number] = [
            before,
            after,
            0,
            hi == h ? 1 : 0,
          ]
          quad(o, [x * V, lo * V, z * V], axis, du, dv, sign, cs, rim, round)
        }
      }
    }
  }
  return o
}
