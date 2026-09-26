// The ground as triangles, one chunk at a time. A column's top is a quad, and
// each side it shows above a lower neighbour is a quad per layer (a green
// band, then earth, then stone). Flat, open tops of one height and one kind
// merge into larger quads; the soft material still draws each voxel, because
// it tints them by their cell (soft.ts), so a merge costs nothing you can see.
// A chunk is a square of ground a fixed number of metres across, however many
// columns that is at the vale's voxel size.
import { Top } from './features.ts'
import type { Level } from './levels.ts'
import { type Out, quad, rgb, type Vec } from './mesh.ts'
import { type Vale } from './terrain.ts'

/** A chunk's side, in metres. */
export let CHUNK = 16

let TOPS: Record<number, number> = {
  [Top.grass]: 0x8cc85c,
  [Top.lush]: 0x5fa24a,
  [Top.dry]: 0xb9bd66,
  [Top.sand]: 0xe8d69c,
  [Top.stone]: 0xa19f96,
  [Top.path]: 0xd2aa70,
  [Top.snow]: 0xf3f5f8,
  [Top.mud]: 0x7f6b4c,
  [Top.heath]: 0x9c8290,
  [Top.spore]: 0x9486c9,
  [Top.ash]: 0x5d5a57,
  [Top.ember]: 0xe0602c,
  [Top.clay]: 0xcd7a4c,
  [Top.ice]: 0xcbe6f3,
}

// What shows on a column's sides: its top layer, then what lies beneath, and
// under that the rock.
let BAND: Record<number, number> = {
  ...TOPS,
  [Top.grass]: 0x7db653,
  [Top.lush]: 0x55933f,
  [Top.dry]: 0xa7ab5a,
  [Top.mud]: 0x6f5d40,
  [Top.heath]: 0x8a707e,
  [Top.spore]: 0x8174b6,
  [Top.ember]: 0xb4401e,
  [Top.ice]: 0xb6dbee,
}
let EARTH: Record<number, number> = {
  [Top.grass]: 0x9c6d47,
  [Top.lush]: 0x8a6040,
  [Top.dry]: 0xa27a4f,
  [Top.sand]: 0xdcc58a,
  [Top.stone]: 0x8f8d85,
  [Top.path]: 0x9c6d47,
  [Top.snow]: 0x9a988f,
  [Top.mud]: 0x5f4b34,
  [Top.heath]: 0x7a5a48,
  [Top.spore]: 0x5e4a6c,
  [Top.ash]: 0x46423f,
  [Top.ember]: 0x4a2a20,
  [Top.clay]: 0xb8683f,
  [Top.ice]: 0xa4cde4,
}
let ROCK: Record<number, number> = {
  [Top.ash]: 0x3c3836,
  [Top.ember]: 0x3c3836,
  [Top.clay]: 0xa65c3a,
  [Top.ice]: 0x8fbdd9,
}
let STONE = 0x8a8983
// A face no corner of which is shaded.
let OPEN: [number, number, number, number] = [3, 3, 3, 3]

/** A level's colours: what its look says each top is, the band under it a
 * shade darker, the rock under stone a shade darker again, and its water,
 * deep, shallow and the sheen on it; the rest as every level has them. */
export type Palette = {
  tops: Record<number, number>
  band: Record<number, number>
  rock: (t: number) => number
  water: [number, number, number]
}
let shade = (hex: number, k: number) => {
  let [r, g, b] = [16, 8, 0].map((n) =>
    Math.round(Math.min(255, ((hex >> n) & 255) * k))
  )
  return (r << 16) | (g << 8) | b
}
export let paletteOf = (lv: Level): Palette => {
  let got = painted.get(lv)
  if (got) return got
  let tops = { ...TOPS }, band = { ...BAND }
  for (let [name, hex] of Object.entries(lv.look?.ground ?? {})) {
    let t = Top[name as keyof typeof Top]
    tops[t] = hex
    band[t] = shade(hex, 0.9)
  }
  let stone = lv.look?.ground?.stone
  let under = stone == null ? STONE : shade(stone, 0.88)
  let [deep, shallow, sheen] = lv.look?.water ?? []
  got = {
    tops,
    band,
    rock: (t) => ROCK[t] ?? under,
    water: [deep ?? 0x2f7fa6, shallow ?? 0x5fb8cf, sheen ?? 0xd9edff],
  }
  painted.set(lv, got)
  return got
}
let painted = new WeakMap<Level, Palette>()

// A colour, drifted by the column's hue: lusher or drier by a little.
let drift = (hex: number, hue: number): Vec => {
  let [r, g, b] = rgb(hex)
  let d = (hue - 0.5) * 0.22
  return [r * (1 - d * 0.6), g * (1 + d * 0.25), b * (1 - d)]
}

/** Write chunk (ci, ck)'s ground into `o`. */
export let groundChunk = (v: Vale, ci: number, ck: number, o: Out) => {
  let V = v.voxel, N = v.cols, C = Math.round(CHUNK / V)
  let { tops, band: BANDS, rock } = paletteOf(v.level)
  let at = (i: number, k: number) =>
    Math.max(0, Math.min(N - 1, i)) + Math.max(0, Math.min(N - 1, k)) * N
  let H = (i: number, k: number) => v.h[at(i, k)]
  let i0 = ci * C, k0 = ck * C
  let round = V * 0.16
  // How deep the green band and the earth under it run, in voxels.
  let band = Math.max(1, Math.round(0.5 / V))
  let earth = Math.max(band + 1, Math.round(2 / V))

  // Tops. A column is merged with its neighbours when nothing about it needs
  // a corner of its own: no edge to round, no shade in a corner.
  let merge = new Int32Array(C * C).fill(-1)
  let single: [number, number][] = []
  for (let dk = 0; dk < C; dk++) {
    for (let di = 0; di < C; di++) {
      let i = i0 + di, k = k0 + dk, h = H(i, k)
      let open = H(i - 1, k) >= h && H(i + 1, k) >= h && H(i, k - 1) >= h &&
        H(i, k + 1) >= h
      let shaded = H(i - 1, k) > h || H(i + 1, k) > h || H(i, k - 1) > h ||
        H(i, k + 1) > h || H(i - 1, k - 1) > h || H(i + 1, k - 1) > h ||
        H(i - 1, k + 1) > h || H(i + 1, k + 1) > h
      if (open && !shaded) merge[di + dk * C] = h * 32 + v.top[at(i, k)]
      else single.push([i, k])
    }
  }
  let colour = (i: number, k: number) =>
    drift(tops[v.top[at(i, k)]], v.hue[at(i, k)])
  let done = new Uint8Array(C * C)
  for (let dk = 0; dk < C; dk++) {
    for (let di = 0; di < C; di++) {
      let key = merge[di + dk * C]
      if (key < 0 || done[di + dk * C]) continue
      let w = 1
      while (
        di + w < C && merge[di + w + dk * C] == key &&
        !done[di + w + dk * C]
      ) w++
      let d = 1
      grow: while (dk + d < C) {
        for (let x = 0; x < w; x++) {
          let j = di + x + (dk + d) * C
          if (merge[j] != key || done[j]) break grow
        }
        d++
      }
      for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) done[di + x + (dk + z) * C] = 1
      }
      let i = i0 + di, k = k0 + dk, h = H(i, k)
      let c = [
        ...colour(i, k),
        ...colour(i + w - 1, k),
        ...colour(i + w - 1, k + d - 1),
        ...colour(i, k + d - 1),
      ]
      quad(
        o,
        [i * V, h * V, k * V],
        1,
        w * V,
        d * V,
        1,
        c,
        [0, 0, 0, 0],
        round,
        OPEN,
        V,
      )
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
      V,
    )
  }

  // Sides: what a column shows above each lower neighbour, one quad per layer.
  let SIDES: [number, number, number, number][] = [
    [-1, 0, 0, -1],
    [1, 0, 0, 1],
    [0, -1, 2, -1],
    [0, 1, 2, 1],
  ]
  for (let dk = 0; dk < C; dk++) {
    for (let di = 0; di < C; di++) {
      let i = i0 + di, k = k0 + dk, h = H(i, k), t = v.top[at(i, k)]
      for (let [si, sk, axis, sign] of SIDES) {
        let nh = H(i + si, k + sk)
        if (nh >= h) continue
        let hue = v.hue[at(i, k)]
        let layers: [number, number, number][] = [
          [h - band, h, BANDS[t]],
          [h - earth, h - band, EARTH[t]],
          [-999, h - earth, rock(t)],
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
          quad(
            o,
            [x * V, lo * V, z * V],
            axis,
            du,
            dv,
            sign,
            cs,
            rim,
            round,
            OPEN,
            V,
          )
        }
      }
    }
  }
  return o
}
