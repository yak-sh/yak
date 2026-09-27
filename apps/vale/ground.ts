// The ground as triangles, one chunk at a time. A column's top is a quad, and
// each side it shows above a lower neighbour is a quad per layer (a green
// band, then earth, then stone). Flat, open tops of one height and one kind
// merge into larger quads; the soft material still draws each voxel, because
// it tints them by their cell (soft.ts), so a merge costs nothing you can see.
// A chunk is meshed from its patch (terrain.ts), the ground grown alone with a
// column more all round it, about the chunk's own north-west corner, so its
// numbers stay small however far out it lies. Each column is coloured as its
// region's look says, blended with the next region's near a border. Its edges
// hang a skirt a few metres down, so a neighbour drawn at a coarser voxel
// (stream.ts) never shows a crack between them.
import { Top } from './features.ts'
import { type Level, LEVELS } from './levels.ts'
import { type Out, quad, rgb, type Vec } from './mesh.ts'
import type { Patch } from './terrain.ts'

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
// How far a chunk's skirt hangs below the lower of its edge and the ground
// beyond, in metres: past the most two details of one hill part by; and how
// far under that ground it starts.
let SKIRT = 3
let TUCK = 0.02
let UP = [0, 1, 0, 0]

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
let drift = ([r, g, b]: Vec, hue: number): Vec => {
  let d = (hue - 0.5) * 0.22
  return [r * (1 - d * 0.6), g * (1 + d * 0.25), b * (1 - d)]
}

/** Write a patch's chunk of ground into `o`, about the chunk's north-west
 * corner. */
export let groundChunk = (p: Patch, o: Out) => {
  let V = p.voxel, N = p.n, C = N - 2
  let pals = p.regions.map((id) => paletteOf(LEVELS[id] ?? LEVELS.mossvale))
  // Column (i, k) of the chunk, from -1 to C, as its patch has it.
  let H = (i: number, k: number) => p.layers[0][i + 1 + (k + 1) * N]
  // A colour of a column's region's look, `of` its palette, blended with the
  // next region's by how much the column is its own.
  let tint = (
    i: number,
    k: number,
    of: (pal: Palette, t: number) => number,
  ) => {
    let j = i + k * C, t = p.top[j]
    let a = rgb(of(pals[p.region[j]], t))
    let s = 0.5 + p.share[j] / 510
    if (s < 1) {
      let b = rgb(of(pals[p.other[j]], t))
      a = [
        a[0] * s + b[0] * (1 - s),
        a[1] * s + b[1] * (1 - s),
        a[2] * s + b[2] * (1 - s),
      ]
    }
    return drift(a, p.hue[j])
  }
  let round = V * 0.16
  // How deep the green band and the earth under it run, in voxels.
  let band = Math.max(1, Math.round(0.5 / V))
  let earth = Math.max(band + 1, Math.round(2 / V))

  // Tops. A column is merged with its neighbours when nothing about it needs
  // a corner of its own: no edge to round, no shade in a corner, and it is not
  // on the chunk's edge, where every corner meets the neighbour's, so no crack
  // opens between the two; and when it is all its own region's.
  let merge = new Int32Array(C * C).fill(-1)
  let single: [number, number][] = []
  for (let k = 0; k < C; k++) {
    for (let i = 0; i < C; i++) {
      let h = H(i, k), j = i + k * C
      let open = H(i - 1, k) >= h && H(i + 1, k) >= h && H(i, k - 1) >= h &&
        H(i, k + 1) >= h
      let shaded = H(i - 1, k) > h || H(i + 1, k) > h || H(i, k - 1) > h ||
        H(i, k + 1) > h || H(i - 1, k - 1) > h || H(i + 1, k - 1) > h ||
        H(i - 1, k + 1) > h || H(i + 1, k + 1) > h
      let edge = !i || !k || i == C - 1 || k == C - 1
      if (open && !shaded && !edge && p.share[j] == 255) {
        merge[j] = (h * 32 + p.top[j]) * 256 + p.region[j]
      } else single.push([i, k])
    }
  }
  let colour = (i: number, k: number) => tint(i, k, (pal, t) => pal.tops[t])
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
      let h = H(di, dk)
      let c = [
        ...colour(di, dk),
        ...colour(di + w - 1, dk),
        ...colour(di + w - 1, dk + d - 1),
        ...colour(di, dk + d - 1),
      ]
      quad(
        o,
        [di * V, h * V, dk * V],
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

  // Sides: what a column shows above each lower neighbour, one quad per layer:
  // its face on axis `axis` (0 or 2) looking `sign` way, at (x, z) in the
  // chunk, from `from` up to `to` voxels, darker at its foot, and rounded
  // along its top and where the ground past a corner is lower still.
  let SIDES: [number, number, number, number][] = [
    [-1, 0, 0, -1],
    [1, 0, 0, 1],
    [0, -1, 2, -1],
    [0, 1, 2, 1],
  ]
  let side = (
    i: number,
    k: number,
    [x, z, axis, sign]: [number, number, number, number],
    from: number,
    to: number,
  ) => {
    let h = H(i, k)
    let layers: [number, number, Vec][] = [
      [h - band, h, tint(i, k, (pal, t) => pal.band[t])],
      [h - earth, h - band, tint(i, k, (_, t) => EARTH[t])],
      [-Infinity, h - earth, tint(i, k, (pal, t) => pal.rock(t))],
    ]
    // The two columns beside this face, along it: a corner is rounded where
    // the one past it is lower still.
    let [ai, ak] = axis == 0 ? [0, 1] : [1, 0]
    for (let [y0, y1, c] of layers) {
      let lo = Math.max(y0, from), hi = Math.min(y1, to)
      if (hi <= lo) continue
      // Darker toward the foot of a wall, where the lower ground meets it.
      let foot = lo == from ? 0.72 : 1
      let cs = [
        ...c.map((x) => x * foot),
        ...c.map((x) => x * foot),
        ...c,
        ...c,
      ]
      let rim: [number, number, number, number] = [
        H(i - ai, k - ak) <= lo ? 1 : 0,
        H(i + ai, k + ak) <= lo ? 1 : 0,
        0,
        hi == h ? 1 : 0,
      ]
      // Axis x faces run along z then y; axis z faces along x then y.
      quad(
        o,
        [x * V, lo * V, z * V],
        axis,
        V,
        (hi - lo) * V,
        sign,
        cs,
        rim,
        round,
        OPEN,
        V,
      )
    }
  }
  // On the chunk's edge, the skirt: one quad from just under the lower of
  // the column and the ground past it, so it never shows along the ground's
  // own edge, down past where a coarser neighbour's ground could lie. It is
  // coloured and lit as the column's top, so what shows of it through a crack
  // is the ground.
  let skirt = (
    i: number,
    k: number,
    [x, z, axis, sign]: [number, number, number, number],
    lo: number,
  ) => {
    let c = colour(i, k)
    quad(
      o,
      [x * V, lo * V - SKIRT, z * V],
      axis,
      V,
      SKIRT - TUCK,
      sign,
      [...c, ...c, ...c, ...c],
      [0, 0, 0, 0],
      round,
      OPEN,
      V,
    )
    o.nrm.splice(-16, 16, ...UP, ...UP, ...UP, ...UP)
  }
  for (let k = 0; k < C; k++) {
    for (let i = 0; i < C; i++) {
      let h = H(i, k)
      for (let [si, sk, axis, sign] of SIDES) {
        let nh = H(i + si, k + sk)
        let face: [number, number, number, number] = [
          axis == 0 && sign > 0 ? i + 1 : i,
          axis == 2 && sign > 0 ? k + 1 : k,
          axis,
          sign,
        ]
        if (nh < h) side(i, k, face, nh, h)
        if (i + si < 0 || i + si >= C || k + sk < 0 || k + sk >= C) {
          skirt(i, k, face, Math.min(h, nh))
        }
      }
    }
  }
  return o
}
