// Models built of boxes: the parts a figure is made of (parts.ts), the look of
// a thing (items.ts), a stack of logs (nodes.ts). A model's boxes are meshed
// as one solid, so no two of its faces are ever drawn in one plane, which is
// what makes the depth buffer flicker between them (z-fighting):
//
//   Each box is worn over the boxes before it. Where one of its sides lies
//   within a step (mesh.ts `STEP`) of the same side of an earlier box it
//   overlaps, it stands a step outside it: a belt over a tunic, plate over
//   the tunic, a helm over hair, a band round a shield. Of the same stuff,
//   colour and material, the two are one surface instead and meet flush.
//
//   A face is drawn only where it shows: not where another box lies against
//   it or over it, nor where a later box of the same surface lies in its
//   plane. What is cut away leaves its edge unrounded, as a joint is.
//
// So a model is written as it is imagined, inside out, a layer at a time, and
// never nudged a few millimetres to keep two faces apart.
import {
  axes,
  materialOf,
  type Out,
  quad,
  rgb,
  STEP,
  type Vec,
} from './mesh.ts'

/** A box: its low corner and its size, in metres, its colour, which says what
 * it is made of too (mesh.ts `metal`), and how wide the rounding of its edges
 * is. */
export type Box = [Vec, Vec, number, number?]

/** A box as its two corners, worn over those before it: what `drawn` draws. */
export type Solid = { lo: Vec; hi: Vec; hex: number; round: number }

// A face's extent in its plane: from (u0, v0) to (u1, v1).
type Rect = [number, number, number, number]

// How near two numbers of metres are the same.
let E = 1e-6

// Where a solid's side lies along `axis`: its low face or its high one.
let sideOf = (s: Solid, axis: number, sign: number) =>
  sign > 0 ? s.hi[axis] : s.lo[axis]

// Whether two solids overlap in the plane of a face on `axis`.
let across = (a: Solid, b: Solid, axis: number) =>
  axes(axis).every((k) =>
    Math.min(a.hi[k], b.hi[k]) - Math.max(a.lo[k], b.lo[k]) > E
  )

/** The boxes as solids, each worn over those before it and over `under`,
 * solids drawn apart that it rests against (parts.ts `knit`): a side within
 * a step of the same side of one it overlaps stands a step outside it, or
 * flush with it where the two are of the same stuff, and so one surface;
 * never so with what is drawn apart, since nothing cuts the two apart.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { STEP } from './mesh.ts'
 * let tunic: Box = [[-0.2, 0, -0.15], [0.4, 0.5, 0.3], 0x4a7ab8]
 * // A belt drawn round the tunic, in its planes, is worn over it.
 * let [, belt] = worn([tunic, [[-0.2, 0.1, -0.15], [0.4, 0.06, 0.3], 0x3d2c20]])
 * assertEquals(belt.hi[0], 0.2 + STEP)
 * // A second piece of the tunic lies flush, a hair inside or not.
 * let [, more] = worn([tunic, [[-0.198, 0.4, -0.1], [0.3, 0.2, 0.2], 0x4a7ab8]])
 * assertEquals(more.lo[0], -0.2)
 * ```
 */
export let worn = (
  boxes: Box[],
  round = 0.035,
  under: Solid[] = [],
): Solid[] => {
  let done: Solid[] = []
  for (let [min, size, hex, r = round] of boxes) {
    let s: Solid = {
      lo: [min[0], min[1], min[2]],
      hi: [min[0] + size[0], min[1] + size[1], min[2] + size[2]],
      hex,
      round: r,
    }
    for (let moved = true; moved;) {
      moved = false
      for (let t of [...under, ...done]) {
        let one = t.hex == s.hex && !under.includes(t)
        for (let axis = 0; axis < 3; axis++) {
          if (!across(t, s, axis)) continue
          for (let sign of [-1, 1]) {
            let p = sideOf(s, axis, sign), q = sideOf(t, axis, sign)
            let d = sign * (p - q)
            if (d <= E - STEP || d >= STEP - E) continue
            let to = one && d <= E ? q : q + sign * STEP
            if (sign * (to - p) <= E) continue
            ;(sign > 0 ? s.hi : s.lo)[axis] = to
            moved = true
          }
        }
      }
    }
    done.push(s)
  }
  return done
}

// Whether `s` fills the space just outside a face on `axis` at `p`, looking
// `sign` way: a box lying against the face, or over it.
let covers = (s: Solid, axis: number, sign: number, p: number) =>
  sign > 0
    ? s.lo[axis] <= p + E && s.hi[axis] > p + E
    : s.hi[axis] >= p - E && s.lo[axis] < p - E

// Every distinct coordinate, in order.
let marks = (xs: number[]) =>
  xs.sort((a, b) => a - b).filter((x, i, all) => !i || x - all[i - 1] > E)

/** What shows of face `f` with `hidden` drawn over it: as few rectangles as
 * cover the rest, runs along u stacked along v.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(shown([0, 0, 1, 1], []), [[0, 0, 1, 1]])
 * // A post standing in the middle of a floor leaves a frame round it.
 * assertEquals(shown([0, 0, 3, 3], [[1, 1, 2, 2]]), [
 *   [0, 0, 3, 1],
 *   [0, 1, 1, 2],
 *   [2, 1, 3, 2],
 *   [0, 2, 3, 3],
 * ])
 * assertEquals(shown([0, 0, 1, 1], [[-1, -1, 2, 2]]), [])
 * ```
 */
export let shown = (f: Rect, hidden: Rect[]): Rect[] => {
  let cut = hidden
    .map(([a, b, c, d]): Rect => [
      Math.max(a, f[0]),
      Math.max(b, f[1]),
      Math.min(c, f[2]),
      Math.min(d, f[3]),
    ])
    .filter(([a, b, c, d]) => c - a > E && d - b > E)
  if (!cut.length) return [f]
  let us = marks([f[0], f[2], ...cut.flatMap((r) => [r[0], r[2]])])
  let vs = marks([f[1], f[3], ...cut.flatMap((r) => [r[1], r[3]])])
  let open = (i: number, j: number) => {
    let u = (us[i] + us[i + 1]) / 2, v = (vs[j] + vs[j + 1]) / 2
    return !cut.some((r) => r[0] < u && u < r[2] && r[1] < v && v < r[3])
  }
  let out: Rect[] = []
  let last = new Map<string, Rect>()
  for (let j = 0; j + 1 < vs.length; j++) {
    let row = new Map<string, Rect>()
    for (let i = 0; i + 1 < us.length; i++) {
      if (!open(i, j)) continue
      let k = i
      while (k + 2 < us.length && open(k + 1, j)) k++
      let run = `${i} ${k}`
      let r = last.get(run)
      if (r) r[3] = vs[j + 1]
      else out.push(r = [us[i], vs[j], us[k + 1], vs[j + 1]])
      row.set(run, r)
      i = k
    }
    last = row
  }
  return out
}

/** Solids moved by `f`, a turn by quarters, a scale and a shift that takes
 * each corner where it goes.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let [s] = worn([[[0, 0, 0], [1, 2, 3], 0xffffff]])
 * let [m] = moved([s], ([x, y, z]) => [2 - x, y + 1, z])
 * assertEquals([m.lo, m.hi], [[1, 1, 0], [2, 3, 3]])
 * ```
 */
export let moved = (solids: Solid[], f: (v: Vec) => Vec): Solid[] =>
  solids.map((s) => {
    let [a, b] = [f(s.lo), f(s.hi)]
    let lo: Vec = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.min(a[2], b[2]),
    ]
    let hi: Vec = [
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
      Math.max(a[2], b[2]),
    ]
    return { ...s, lo, hi }
  })

/** Solids drawn as one, soft on every edge, as if built of voxels `cell`
 * across, of whatever each one's colour says it is made of (mesh.ts
 * `metal`): each face only where it shows. */
export let drawn = (o: Out, solids: Solid[], cell = 0.1) => {
  for (let [i, s] of solids.entries()) {
    let c = rgb(s.hex)
    let cs = [...c, ...c, ...c, ...c]
    for (let axis = 0; axis < 3; axis++) {
      let [ua, va] = axes(axis)
      for (let sign of [-1, 1]) {
        let p = sideOf(s, axis, sign)
        let face: Rect = [s.lo[ua], s.lo[va], s.hi[ua], s.hi[va]]
        let hidden = solids.flatMap((t, k): Rect[] =>
          k != i && (covers(t, axis, sign, p) ||
              k > i && Math.abs(sideOf(t, axis, sign) - p) <= E)
            ? [[t.lo[ua], t.lo[va], t.hi[ua], t.hi[va]]]
            : []
        )
        for (let [u0, v0, u1, v1] of shown(face, hidden)) {
          let at: Vec = [0, 0, 0]
          at[axis] = p
          at[ua] = u0
          at[va] = v0
          quad(
            o,
            at,
            axis,
            u1 - u0,
            v1 - v0,
            sign,
            cs,
            [
              u0 - face[0] <= E ? 1 : 0,
              face[2] - u1 <= E ? 1 : 0,
              v0 - face[1] <= E ? 1 : 0,
              face[3] - v1 <= E ? 1 : 0,
            ],
            s.round,
            undefined,
            cell,
            materialOf(s.hex),
          )
        }
      }
    }
  }
  return o
}

/**
 * Boxes as one solid, each worn over those before it, soft on every edge
 * (`round` metres wide, or as a box says) and drawn as if built of voxels
 * `cell` across.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { fights, metal, METAL, out, pack } from './mesh.ts'
 * let faces = (o: ReturnType<typeof out>) => o.pos.length / 12
 * let blade = cuboids(out(), [[[0, 0, 0], [1, 1, 1], metal(0xdfe6ee)]])
 * assertEquals(faces(blade), 6)
 * // each vertex's edge ends in what it is made of
 * assertEquals(blade.edge[3], METAL)
 * // Two boxes side by side: the faces between them are not drawn.
 * let pair = cuboids(out(), [
 *   [[0, 0, 0], [1, 1, 1], 0xffffff],
 *   [[1, 0, 0], [1, 1, 1], 0xff0000],
 * ])
 * assertEquals(faces(pair), 10)
 * // A band round a box, a helm over hair: nothing drawn twice in a plane.
 * let band = cuboids(out(), [
 *   [[0, 0, 0], [1, 1, 1], 0xffffff],
 *   [[0, 0.4, 0], [1, 0.2, 1], 0xff0000],
 * ])
 * assertEquals(fights(pack(band)), [])
 * ```
 */
export let cuboids = (o: Out, boxes: Box[], cell = 0.1, round = 0.035) =>
  drawn(o, worn(boxes, round), cell)
