// Buildings as a walker and the camera meet them. A building's model is
// voxels (buildings/kit.ts `raise`); its solid shape is the same voxels,
// column by column, so it is solid exactly where it is drawn. Each question
// is asked of one building and a point: what of it stands in a walker's way
// (`blocks`), what they stand on in it (`floorIn`), what is over their head
// (`ceilingIn`), whether they are in it (`holds`), whether the camera may
// stand there (`walls`), and what of it fades (`cutOf`). The world answers
// with the buildings near the point (terrain.ts `Vale.buildings`): `hits`,
// `standOn`, `over`, `within`, `walled` and `cutaway`.
//
// A door is not in the voxels: it swings open for whoever comes near it, so a
// walker that opens doors (a hero, a villager) is never stopped by one, and
// one that does not (a creature) is stopped by every one (`shutIn`, `shut`).
import {
  type Door,
  type Glow,
  type Raised,
  spin,
  type Use,
} from './buildings/kit.ts'
import { unkey, type Vec, type Vox } from './mesh.ts'
import type { Craft } from './trades.ts'
import type { Vale } from './terrain.ts'

/** A model's solid voxels, column by column: column (i, k), for i in
 * [i0, i0 + w) and k in [k0, k0 + d), holds the runs `runs[at[c]]` to
 * `runs[at[c + 1]]` (c = i − i0 + (k − k0) × w), each a pair [lo, hi) of
 * voxel heights. A run from the ground (0) goes on down, as a footing does.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { key } from './mesh.ts'
 * let v = new Map([[key(0, 0, 0), 1], [key(0, 1, 0), 1], [key(0, 4, 0), 1]])
 * let s = solidOf(v)
 * assertEquals([...s.runs], [LOW, 2, 4, 5])
 * ```
 */
export type Solid = {
  i0: number
  k0: number
  w: number
  d: number
  at: Uint32Array
  runs: Int16Array
}

/** How far down a footing goes, in voxels. */
export let LOW = -32768

export let solidOf = (vox: Vox): Solid => {
  let cols = new Map<number, number[]>()
  let i0 = Infinity, k0 = Infinity, i1 = -Infinity, k1 = -Infinity
  for (let key of vox.keys()) {
    let [i, j, k] = unkey(key)
    i0 = Math.min(i0, i), i1 = Math.max(i1, i)
    k0 = Math.min(k0, k), k1 = Math.max(k1, k)
    let c = (i + 512) * 1024 + k + 512
    if (!cols.has(c)) cols.set(c, [])
    cols.get(c)!.push(j)
  }
  let w = i1 - i0 + 1, d = k1 - k0 + 1
  let at = new Uint32Array(w * d + 1), runs: number[] = []
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
      at[i - i0 + (k - k0) * w] = runs.length
      let ys = cols.get((i + 512) * 1024 + k + 512)?.sort((a, b) => a - b)
      for (let n = 0; ys && n < ys.length; n++) {
        let lo = ys[n]
        while (n + 1 < ys.length && ys[n + 1] == ys[n] + 1) n++
        runs.push(lo == 0 ? LOW : lo, ys[n] + 1)
      }
    }
  }
  at[w * d] = runs.length
  return { i0, k0, w, d, at, runs: Int16Array.from(runs) }
}

// A solid a quarter turn on, as kit.ts `spun` turns its voxels about the
// corner at their origin: column (i, k) moves to (k, −i − 1), and its runs
// go with it, so turning never sorts a voxel again.
let quarter = ({ i0, k0, w, d, at, runs }: Solid): Solid => {
  let cols = new Uint32Array(w * d + 1), out = new Int16Array(runs.length)
  let n = 0
  for (let k = 0; k < w; k++) {
    for (let i = 0; i < d; i++) {
      let c = w - 1 - k + i * w
      cols[i + k * d] = n
      out.set(runs.subarray(at[c], at[c + 1]), n)
      n += at[c + 1] - at[c]
    }
  }
  cols[w * d] = n
  return { i0: k0, k0: -i0 - w, w: d, d: w, at: cols, runs: out }
}

/** A station a hero works at, where it stands, in metres. */
export type Station = { craft: Craft; x: number; y: number; z: number }

/** A building as the world placed it: its kind, where its foot's middle stands
 * and its quarter turns, its voxels' edge, its solid shape, the ground its
 * walls stand on and everything it takes (west, north, east, south, in
 * metres), each storey's floor and then its eaves, its top, and its doors,
 * uses, lights and stations, all in the world's metres. */
export type Building = {
  kind: string
  x: number
  y: number
  z: number
  turn: number
  size: number
  solid: Solid
  foot: [number, number, number, number]
  box: [number, number, number, number]
  floors: number[]
  top: number
  doors: Door[]
  uses: Use[]
  glows: Glow[]
  stations: Station[]
}

let solids = new WeakMap<Vox, Solid[]>()

/** A building of kind `kind` placed at (x, y, z), turned `turn` quarter
 * turns (its front, the south, to the east for one). */
export let placed = (
  kind: string,
  r: Raised,
  [x, y, z]: Vec,
  turn: number,
): Building => {
  turn = ((turn % 4) + 4) % 4
  let got = solids.get(r.vox) ?? []
  solids.set(r.vox, got)
  let solidAt = (t: number): Solid =>
    got[t] ??= t ? quarter(solidAt(t - 1)) : solidOf(r.vox)
  let solid = solidAt(turn)
  let S = r.size
  let to = ([a, b, c]: Vec): Vec => {
    let [p, q] = spin(a, c, turn)
    return [x + p, y + b, z + q]
  }
  let way = ([a, b]: [number, number]) => spin(a, b, turn)
  let [fw, fd] = turn & 1 ? [r.foot[1], r.foot[0]] : r.foot
  let top = 0
  for (let n = 1; n < solid.runs.length; n += 2) {
    top = Math.max(top, solid.runs[n])
  }
  return {
    kind,
    x,
    y,
    z,
    turn,
    size: S,
    solid,
    foot: [x - fw / 2, z - fd / 2, x + fw / 2, z + fd / 2],
    box: [
      x + solid.i0 * S,
      z + solid.k0 * S,
      x + (solid.i0 + solid.w) * S,
      z + (solid.k0 + solid.d) * S,
    ],
    floors: r.floors.map((f) => y + f),
    top: y + top * S,
    doors: r.doors.map((d) => ({
      ...d,
      hinge: to(d.hinge),
      along: way(d.along),
      into: way(d.into),
    })),
    uses: r.uses.map((u) => ({
      ...u,
      at: to(u.at),
      yaw: u.yaw + (turn * Math.PI) / 2,
    })),
    glows: r.glows.map((g) => ({ ...g, at: to(g.at) })),
    stations: r.stations.map((s) => {
      let [a, b, c] = to(s.at)
      return { craft: s.craft, x: a, y: b, z: c }
    }),
  }
}

// Each column of `b` a circle `r` about (x, z) reaches, as its runs' bounds in
// `b.solid.runs`; `each` stops early by returning true.
let reach = (
  b: Building,
  x: number,
  z: number,
  r: number,
  each: (from: number, to: number) => boolean | void,
): boolean => {
  let { i0, k0, w, d, at } = b.solid, S = b.size
  let ia = Math.max(0, Math.floor((x - r - b.x) / S) - i0)
  let ib = Math.min(w - 1, Math.floor((x + r - b.x) / S) - i0)
  let ka = Math.max(0, Math.floor((z - r - b.z) / S) - k0)
  let kb = Math.min(d - 1, Math.floor((z + r - b.z) / S) - k0)
  for (let k = ka; k <= kb; k++) {
    let cz = b.z + (k + k0) * S
    let dz = z < cz ? cz - z : z > cz + S ? z - cz - S : 0
    for (let i = ia; i <= ib; i++) {
      let cx = b.x + (i + i0) * S
      let dx = x < cx ? cx - x : x > cx + S ? x - cx - S : 0
      if (dx * dx + dz * dz >= r * r) continue
      let c = i + k * w
      if (at[c] < at[c + 1] && each(at[c], at[c + 1])) return true
    }
  }
  return false
}

/** Whether anything a building takes comes within `r` of (x, z), to a
 * side or a corner of the square round it: the one test of which buildings
 * a question of a point is asked of. */
export let near = (b: Building, x: number, z: number, r: number): boolean =>
  x > b.box[0] - r && x < b.box[2] + r && z > b.box[1] - r && z < b.box[3] + r

/** Whether a point and its room touch any building's ground footprint. */
export let onFoot = (v: Vale, x: number, z: number, r: number): boolean =>
  v.buildings(x, z, r).some((b) =>
    x > b.foot[0] - r && x < b.foot[2] + r &&
    z > b.foot[1] - r && z < b.foot[3] + r
  )

/** The last point on a line from `from` to `to` before it enters a building's
 * footprint, with `r` metres of room round the walker. */
export let beforeFoot = (
  v: Vale,
  from: [number, number],
  to: [number, number],
  r: number,
): [number, number] => {
  let [x, z] = from, dx = to[0] - x, dz = to[1] - z
  let mx = (x + to[0]) / 2, mz = (z + to[1]) / 2
  let reach = Math.hypot(dx, dz) / 2 + r
  let stop = 1
  for (let b of v.buildings(mx, mz, reach)) {
    let enter = 0, leave = 1
    for (
      let [at, step, lo, hi] of [
        [x, dx, b.foot[0] - r, b.foot[2] + r],
        [z, dz, b.foot[1] - r, b.foot[3] + r],
      ]
    ) {
      if (!step) {
        if (at <= lo || at >= hi) leave = -1
      } else {
        let a = (lo - at) / step, c = (hi - at) / step
        enter = Math.max(enter, Math.min(a, c))
        leave = Math.min(leave, Math.max(a, c))
      }
    }
    if (enter <= leave && leave >= 0) stop = Math.min(stop, enter)
  }
  stop = Math.max(0, stop - (stop < 1 ? 1e-4 : 0))
  return [x + dx * stop, z + dz * stop]
}

/** Whether anything of building `b` within `r` metres of (x, z) is solid
 * anywhere from height `lo` up to `hi`. */
export let blocks = (
  b: Building,
  x: number,
  z: number,
  lo: number,
  hi: number,
  r: number,
): boolean =>
  near(b, x, z, r) && reach(b, x, z, r, (from, to) => {
    let runs = b.solid.runs
    for (let n = from; n < to; n += 2) {
      if (b.y + runs[n] * b.size < hi && b.y + runs[n + 1] * b.size > lo) {
        return true
      }
    }
  })

/** The highest top of `b`'s voxels within `r` of (x, z) at or under height
 * `y`, or −Infinity. */
export let floorIn = (
  b: Building,
  x: number,
  z: number,
  y: number,
  r: number,
): number => {
  let best = -Infinity
  if (near(b, x, z, r)) {
    reach(b, x, z, r, (from, to) => {
      for (let n = from; n < to; n += 2) {
        let top = b.y + b.solid.runs[n + 1] * b.size
        if (top <= y + 1e-6 && top > best) best = top
      }
    })
  }
  return best
}

/** The lowest underside of `b`'s voxels within `r` of (x, z) over height
 * `y`, or Infinity: what a jump bumps its head on. */
export let ceilingIn = (
  b: Building,
  x: number,
  z: number,
  y: number,
  r: number,
): number => {
  let best = Infinity
  if (near(b, x, z, r)) {
    reach(b, x, z, r, (from, to) => {
      for (let n = from; n < to; n += 2) {
        let low = b.y + b.solid.runs[n] * b.size
        if (low > y && low < best) best = low
      }
    })
  }
  return best
}

// How near a door, in metres, it opens.
export let OPEN = 2.4

/** Whether a door's middle is within reach of opening for someone at
 * (x, y, z). */
export let opensFor = (d: Door, x: number, y: number, z: number) => {
  let mx = d.hinge[0] + d.along[0] * d.wide / 2
  let mz = d.hinge[2] + d.along[1] * d.wide / 2
  return Math.hypot(mx - x, mz - z) < OPEN && Math.abs(y - d.hinge[1]) < 2
}

/** Whether one of `b`'s doors, shut, stands within `r` of (x, z), anywhere
 * from `lo` up to `hi`: in the way of a walker that opens no doors. */
export let shutIn = (
  b: Building,
  x: number,
  z: number,
  lo: number,
  hi: number,
  r: number,
): boolean =>
  near(b, x, z, r) && b.doors.some((d) => {
    if (d.hinge[1] >= hi || d.hinge[1] + d.tall <= lo) return false
    let px = x - d.hinge[0], pz = z - d.hinge[2]
    let t = Math.max(0, Math.min(d.wide, px * d.along[0] + pz * d.along[1]))
    return Math.hypot(px - d.along[0] * t, pz - d.along[1] * t) < r + 0.06
  })

/** Whether someone at (x, y, z) stands within `b`'s walls. */
export let holds = (b: Building, x: number, y: number, z: number) =>
  x > b.foot[0] && x < b.foot[2] && z > b.foot[1] && z < b.foot[3] &&
  y > b.floors[0] - 0.6 && y < b.top

/** How high a building's ground storey reaches before the floor over it: the
 * camera meets what is under it, and looks through what fades over it. */
let ceiling = (b: Building) => b.floors[1] - b.size

/** Whether `b` stands solid at (x, y, z) under its first ceiling: where the
 * camera may not stand, unless it is looking into `b`. */
export let walls = (b: Building, x: number, y: number, z: number) =>
  y < ceiling(b) && near(b, x, z, 0) &&
  reach(b, x, z, 1e-3, (from, to) => {
    for (let n = from; n < to; n += 2) {
      if (
        b.y + b.solid.runs[n] * b.size <= y &&
        b.y + b.solid.runs[n + 1] * b.size > y
      ) return true
    }
  })

/** A building to fade, from height `from` up. */
export type Cut = { b: Building; from: number }

/** What of `b` fades for a hero whose feet are at `feet`, seen from `eye`:
 * over the storey they stand in, the floors above and the roof, if they are
 * in it; over its ground storey, if it stands between them and the eye; or
 * nothing. */
export let cutOf = (b: Building, feet: Vec, eye: Vec): Cut | null => {
  if (holds(b, ...feet)) {
    let f = b.floors, s = 0
    while (s + 1 < f.length - 1 && f[s + 1] <= feet[1] + 0.3) s++
    return {
      b,
      from: s + 1 < f.length - 1 ? f[s + 1] - b.size : f[f.length - 1],
    }
  }
  let head: Vec = [feet[0], feet[1] + 1.2, feet[2]]
  return crosses(b, eye, head) ? { b, from: ceiling(b) } : null
}

/** Whether anything of a building within `r` metres of (x, z) is solid
 * anywhere from height `lo` up to `hi`. */
export let hits = (
  v: Vale,
  x: number,
  z: number,
  lo: number,
  hi: number,
  r: number,
): boolean => v.buildings(x, z, r).some((b) => blocks(b, x, z, lo, hi, r))

/** The highest top of a building's voxels within `r` of (x, z) at or under
 * height `y`, or −Infinity. */
export let standOn = (
  v: Vale,
  x: number,
  z: number,
  y: number,
  r: number,
): number =>
  Math.max(
    -Infinity,
    ...v.buildings(x, z, r).map((b) => floorIn(b, x, z, y, r)),
  )

/** The lowest underside of a building's voxels within `r` of (x, z) over
 * height `y`, or Infinity. */
export let over = (
  v: Vale,
  x: number,
  z: number,
  y: number,
  r: number,
): number =>
  Math.min(
    Infinity,
    ...v.buildings(x, z, r).map((b) => ceilingIn(b, x, z, y, r)),
  )

/** Whether a shut door stands within `r` of (x, z), anywhere from `lo` up
 * to `hi`. */
export let shut = (
  v: Vale,
  x: number,
  z: number,
  lo: number,
  hi: number,
  r: number,
): boolean => v.buildings(x, z, r).some((b) => shutIn(b, x, z, lo, hi, r))

/** The building whose walls someone at (x, y, z) stands within, if any. */
export let within = (v: Vale, x: number, y: number, z: number) =>
  v.buildings(x, z, 0).find((b) => holds(b, x, y, z)) ?? null

/** Whether a building other than `home` (the one the hero is in, which the
 * camera sees into) stands solid at (x, y, z), under its first ceiling. */
export let walled = (
  v: Vale,
  x: number,
  y: number,
  z: number,
  home: Building | null,
): boolean => v.buildings(x, z, 0).some((b) => b != home && walls(b, x, y, z))

/** What of which buildings fades for a hero whose feet are at `feet`, seen
 * from `eye` (`cutOf`), of the buildings near the line between them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { seedBuildings } from './buildings_fixture.ts'
 * import { flat } from './terrain.ts'
 * seedBuildings()
 * let v = flat(5, [], [{ kind: 'smithy.plaster', x: 64, z: 64, seed: 0 }])
 * let b = v.buildings(64, 64, 0)[0]
 * // Inside on the ground floor: everything over its ceiling fades.
 * let cut = cutaway(v, [64, b.floors[0], 64], [64, 12, 76])
 * assertEquals(cut.map((c) => c.from), [b.floors[1] - 0.25])
 * // Upstairs, just the roof.
 * assertEquals(cutaway(v, [64, b.floors[1], 64], [64, 14, 76])[0].from, b.floors[2])
 * // Behind it, seen through it: it fades over its ground storey.
 * assertEquals(cutaway(v, [64, 5, 56], [64, 9, 74]).length, 1)
 * // Out in the open: nothing.
 * assertEquals(cutaway(v, [80, 5, 80], [80, 9, 90]), [])
 * ```
 */
export let cutaway = (v: Vale, feet: Vec, eye: Vec): Cut[] => {
  let mx = (feet[0] + eye[0]) / 2, mz = (feet[2] + eye[2]) / 2
  let r = Math.hypot(feet[0] - eye[0], feet[2] - eye[2]) / 2
  return v.buildings(mx, mz, r).flatMap((b) => cutOf(b, feet, eye) ?? [])
}

// Whether the segment from `a` to `c` passes through a building's box, from
// its foot to its top.
let crosses = (b: Building, a: Vec, c: Vec) => {
  let lo = [b.box[0], b.y, b.box[1]], hi = [b.box[2], b.top, b.box[3]]
  let t0 = 0, t1 = 1
  for (let i = 0; i < 3; i++) {
    let d = c[i] - a[i]
    if (Math.abs(d) < 1e-9) {
      if (a[i] < lo[i] || a[i] > hi[i]) return false
      continue
    }
    let u = (lo[i] - a[i]) / d, w = (hi[i] - a[i]) / d
    t0 = Math.max(t0, Math.min(u, w))
    t1 = Math.min(t1, Math.max(u, w))
    if (t0 > t1) return false
  }
  return true
}
