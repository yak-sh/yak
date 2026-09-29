// A village's square and the streets to its doors and outer ways. The
// network is laid from the placed buildings and props, so a shifted plot
// still has a path. Routes clear footprints and join the nearest street
// already laid. Each ground column asks this plan for its height and cover.
import type { Building } from './solid.ts'
import type { Spot } from './levels.ts'
import { halfOf, KINDS } from './props.ts'
import type { Prop } from './terrain.ts'

export let EDGE = 56
let SIDE = EDGE * 2 + 1
let count = SIDE * SIDE
let NEXT = [1, -1, SIDE, -SIDE]
let index = (i: number, k: number) => i + EDGE + (k + EDGE) * SIDE
let point = (j: number): Spot => [j % SIDE - EDGE, Math.floor(j / SIDE) - EDGE]
let inside = (i: number, k: number) =>
  Math.abs(i) <= EDGE && Math.abs(k) <= EDGE
let near = (x: number, z: number, b: Building, room = 1.6) =>
  x > b.foot[0] - room && x < b.foot[2] + room &&
  z > b.foot[1] - room && z < b.foot[3] + room
let door = (x: number, z: number, b: Building) =>
  b.doors.some((d) => {
    let mx = d.hinge[0] + d.along[0] * d.wide / 2
    let mz = d.hinge[2] + d.along[1] * d.wide / 2
    let out = -((x - mx) * d.into[0] + (z - mz) * d.into[1])
    let side = Math.abs((x - mx) * d.along[0] + (z - mz) * d.along[1])
    return out > 0 && out <= 3.5 && side < d.wide / 2 + 0.6
  })

export type Street = {
  at: Spot
  cells: Map<number, number>
  doors: Spot[]
  entries: Spot[]
  /** Whether a point is within `r` metres of a street cell. */
  near: (x: number, z: number, r: number) => boolean
  /** A path height and cover for a point, or none beyond the streets. */
  lay: (
    x: number,
    z: number,
    h: number,
  ) => { h: number; path: boolean; step: boolean } | null
}

/** A connected street from a village's square to its doors and outer ways. */
export let streets = (
  at: Spot,
  buildings: Building[],
  props: Prop[],
  entries: Spot[],
  rise: (x: number, z: number) => number,
): Street => {
  let blocked = new Uint8Array(count)
  let fixed = props.filter((p) => !KINDS[p.kind].raise).map((p) => {
    let [w, d] = halfOf(p.kind, p.turn)
    return { x: p.x, z: p.z, w, d }
  })
  for (let k = -EDGE; k <= EDGE; k++) {
    for (let i = -EDGE; i <= EDGE; i++) {
      let x = at[0] + i, z = at[1] + k
      blocked[index(i, k)] = +(
        buildings.some((b) => near(x, z, b) && !door(x, z, b)) ||
        fixed.some((p) =>
          Math.abs(x - p.x) < p.w + 1.6 &&
          Math.abs(z - p.z) < p.d + 1.6
        )
      )
    }
  }
  for (let [x, z] of entries) {
    let i = Math.round(x - at[0]), k = Math.round(z - at[1])
    if (!inside(i, k) || blocked[index(i, k)]) {
      throw new Error(`No clear village entry at ${x}, ${z}`)
    }
  }
  let cells = new Map<number, number>()
  let anchors = new Set<number>()
  let square = Array.from({ length: 13 * 13 }, (_, j) => {
    let i = j % 13 - 6, k = Math.floor(j / 13) - 6
    return [i, k] as Spot
  }).filter(([i, k]) => i * i + k * k <= 36 && !blocked[index(i, k)])
    .sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
  let root = square[0]
  if (root) {
    let queue = [index(...root)], seen = new Set(queue)
    anchors.add(queue[0])
    for (let j of queue) {
      let [i, k] = point(j)
      cells.set(j, rise(at[0] + i, at[1] + k))
      for (let [di, dk] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        let a = i + di, b = k + dk, next = index(a, b)
        if (a * a + b * b > 36 || seen.has(next) || blocked[next]) continue
        seen.add(next), queue.push(next)
      }
    }
  }
  let doors: Spot[] = []
  let targets = [
    ...entries.map((at) => ({ at, y: rise(...at), d: undefined })),
    ...[...buildings].sort((a, c) =>
      Math.hypot(a.x - at[0], a.z - at[1]) -
      Math.hypot(c.x - at[0], c.z - at[1])
    ).flatMap((b) =>
      b.doors.map((d) => ({
        at: [
          d.hinge[0] + d.along[0] * d.wide / 2 - d.into[0] * 2.4,
          d.hinge[2] + d.along[1] * d.wide / 2 - d.into[1] * 2.4,
        ] as Spot,
        y: b.y,
        d,
      }))
    ),
  ]
  for (let target of targets) {
    let [x, z] = target.at
    let i = Math.round(x - at[0]), k = Math.round(z - at[1])
    if (!inside(i, k)) continue
    let start = index(i, k)
    if (target.d) doors.push([x, z])
    anchors.add(start)
    let seen = new Uint8Array(count), prev = new Int32Array(count)
    let queue = new Int32Array(count), head = 0, tail = 0
    queue[tail++] = start, seen[start] = 1
    let end = -1
    while (head < tail) {
      let j = queue[head++], [u, v] = point(j)
      let held = cells.get(j)
      if (held != null) {
        end = j
        break
      }
      for (let [di, dk] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        let a = u + di, c = v + dk
        if (!inside(a, c)) continue
        let next = index(a, c)
        if (seen[next] || blocked[next]) continue
        seen[next] = 1, prev[next] = j
        queue[tail++] = next
      }
    }
    if (end < 0) throw new Error(`No street to ${x}, ${z}`)
    let route: number[] = []
    for (let j = end; j != start; j = prev[j]) route.push(j)
    route.push(start)
    let from = cells.get(end)!, length = route.length - 1
    for (let n = 1; n <= length; n++) {
      cells.set(route[n], from + (target.y - from) * n / length)
    }
    cells.set(start, target.y)
    if (target.d) {
      let d = target.d
      let mx = d.hinge[0] + d.along[0] * d.wide / 2
      let mz = d.hinge[2] + d.along[1] * d.wide / 2
      for (let out of [0.8, 1.3, 1.8, 2.4]) {
        for (let side of [-1, -0.5, 0, 0.5, 1]) {
          let a = Math.round(mx - d.into[0] * out + d.along[0] * side - at[0])
          let c = Math.round(mz - d.into[1] * out + d.along[1] * side - at[1])
          if (!inside(a, c)) continue
          let j = index(a, c)
          cells.set(j, target.y)
          anchors.add(j)
        }
      }
    }
  }
  // Routes may lie side by side where they climb at different rates. Ease
  // their shared edge without moving the square or a door's landing, in the
  // order the cells were laid. Heights are kept in a grid, NaN off the
  // streets and a row past its end, as every column of ground asks of them.
  let order = [...cells.keys()]
  let ys = new Float64Array(count + SIDE).fill(NaN)
  let pinned = new Uint8Array(count + SIDE)
  for (let [j, y] of cells) ys[j] = y
  for (let j of anchors) pinned[j] = 1
  for (let pass = 0; pass < 400; pass++) {
    let moved = false
    for (let j of order) {
      for (let next of [j + 1, j + SIDE]) {
        if (next == j + 1 && j % SIDE == SIDE - 1) continue
        let y = ys[j], other = ys[next]
        if (Number.isNaN(other) || Math.abs(other - y) <= 0.48) continue
        let excess = Math.abs(other - y) - 0.48
        let sign = Math.sign(other - y)
        let a = pinned[j] == 1, b = pinned[next] == 1
        if (a && b) continue
        if (!a) ys[j] = y + sign * excess * (b ? 1 : 0.5)
        if (!b) ys[next] = other - sign * excess * (a ? 1 : 0.5)
        moved = true
      }
    }
    if (!moved) break
  }
  for (let j of order) cells.set(j, ys[j])
  // A street cell's height, or undefined off the streets.
  let held = (j: number) => ys[j] === ys[j] ? ys[j] : undefined
  let lay = (x: number, z: number, h: number) => {
    let i = Math.round(x - at[0]), k = Math.round(z - at[1])
    let best = Infinity, height = 0, cell = -1
    for (let dk = -2; dk <= 2; dk++) {
      for (let di = -2; di <= 2; di++) {
        if (!inside(i + di, k + dk)) continue
        let y = held(index(i + di, k + dk))
        if (y == null) continue
        let dx = x - at[0] - i - di, dz = z - at[1] - k - dk
        let d = Math.hypot(dx, dz)
        if (d < best) best = d, height = y, cell = index(i + di, k + dk)
      }
    }
    if (best >= 2.3) return null
    let blend = Math.min(1, Math.max(0, (2.3 - best) / 1.4))
    let step = NEXT.some((d) => {
      let y = held(cell + d)
      return y != null && Math.abs(y - height) >= 0.2
    })
    return {
      h: h + (height - h) * blend,
      path: best < 0.9,
      step: best < 0.9 && step,
    }
  }
  let close = (x: number, z: number, r: number) => {
    let a = Math.ceil(x - at[0] - r), b = Math.floor(x - at[0] + r)
    let c = Math.ceil(z - at[1] - r), d = Math.floor(z - at[1] + r)
    for (let k = Math.max(-EDGE, c); k <= Math.min(EDGE, d); k++) {
      for (let i = Math.max(-EDGE, a); i <= Math.min(EDGE, b); i++) {
        if (
          held(index(i, k)) != null &&
          Math.hypot(x - at[0] - i, z - at[1] - k) < r
        ) return true
      }
    }
    return false
  }
  return { at, cells, doors, entries, lay, near: close }
}
