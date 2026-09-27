// A village's square and the streets to its doors. The network is laid once
// from the buildings as placed in the world, so a shifted plot still has a
// path. Routes keep clear of footprints and join the nearest street already
// laid. Each ground column asks this plan for its height and cover.
import type { Building } from './solid.ts'
import type { Spot } from './levels.ts'

let EDGE = 46
let SIDE = EDGE * 2 + 1
let count = SIDE * SIDE
let NEXT = [1, -1, SIDE, -SIDE]
let index = (i: number, k: number) => i + EDGE + (k + EDGE) * SIDE
let point = (j: number): Spot => [j % SIDE - EDGE, Math.floor(j / SIDE) - EDGE]
let inside = (i: number, k: number) =>
  Math.abs(i) <= EDGE && Math.abs(k) <= EDGE
let near = (x: number, z: number, b: Building, room = 0.7) =>
  x > b.foot[0] - room && x < b.foot[2] + room &&
  z > b.foot[1] - room && z < b.foot[3] + room

export type Street = {
  at: Spot
  cells: Map<number, number>
  doors: Spot[]
  /** A path height and cover for a point, or none beyond the streets. */
  lay: (
    x: number,
    z: number,
    h: number,
  ) => { h: number; path: boolean; step: boolean } | null
}

/** A connected street from a village's square to every placed door. */
export let streets = (
  at: Spot,
  buildings: Building[],
  rise: (x: number, z: number) => number,
): Street => {
  let blocked = new Uint8Array(count)
  for (let k = -EDGE; k <= EDGE; k++) {
    for (let i = -EDGE; i <= EDGE; i++) {
      blocked[index(i, k)] = +buildings.some((b) =>
        near(at[0] + i, at[1] + k, b)
      )
    }
  }
  let cells = new Map<number, number>()
  let anchors = new Set<number>()
  for (let k = -3; k <= 3; k++) {
    for (let i = -3; i <= 3; i++) {
      if (i * i + k * k > 9 || blocked[index(i, k)]) continue
      let j = index(i, k)
      cells.set(j, rise(at[0] + i, at[1] + k))
      anchors.add(j)
    }
  }
  let doors: Spot[] = []
  for (
    let b of [...buildings].sort((a, c) =>
      Math.hypot(a.x - at[0], a.z - at[1]) -
      Math.hypot(c.x - at[0], c.z - at[1])
    )
  ) {
    for (let d of b.doors) {
      let mx = d.hinge[0] + d.along[0] * d.wide / 2
      let mz = d.hinge[2] + d.along[1] * d.wide / 2
      let x = mx - d.into[0] * 2.4, z = mz - d.into[1] * 2.4
      let i = Math.round(x - at[0]), k = Math.round(z - at[1])
      if (!inside(i, k)) continue
      let start = index(i, k)
      doors.push([x, z])
      anchors.add(start)
      let seen = new Uint8Array(count), prev = new Int32Array(count)
      let steps = new Uint16Array(count)
      let queue = new Int32Array(count), head = 0, tail = 0
      queue[tail++] = start, seen[start] = 1
      let end = -1
      while (head < tail) {
        let j = queue[head++], [u, v] = point(j)
        let held = cells.get(j)
        if (held != null && Math.abs(b.y - held) <= steps[j] * 0.4) {
          end = j
          break
        }
        for (let [di, dk] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          let a = u + di, c = v + dk
          if (!inside(a, c)) continue
          let next = index(a, c)
          if (
            seen[next] || blocked[next] && next != start ||
            cells.has(next) &&
              Math.abs(b.y - cells.get(next)!) > (steps[j] + 1) * 0.4
          ) {
            continue
          }
          seen[next] = 1, prev[next] = j, steps[next] = steps[j] + 1
          queue[tail++] = next
        }
      }
      if (end < 0) continue
      let route: number[] = []
      for (let j = end; j != start; j = prev[j]) route.push(j)
      route.push(start)
      let from = cells.get(end)!, length = route.length - 1
      for (let n = 1; n <= length; n++) {
        cells.set(route[n], from + (b.y - from) * n / length)
      }
      cells.set(start, b.y)
      for (let out of [0.8, 1.3, 1.8, 2.4]) {
        for (let side of [-1, -0.5, 0, 0.5, 1]) {
          let a = Math.round(mx - d.into[0] * out + d.along[0] * side - at[0])
          let c = Math.round(mz - d.into[1] * out + d.along[1] * side - at[1])
          if (!inside(a, c)) continue
          let j = index(a, c)
          cells.set(j, b.y)
          anchors.add(j)
        }
      }
    }
  }
  // Routes may lie side by side where they climb at different rates. Ease
  // their shared edge without moving the square or a door's landing.
  for (let pass = 0; pass < 400; pass++) {
    let moved = false
    for (let [j] of cells) {
      for (let next of [j + 1, j + SIDE]) {
        if (next == j + 1 && j % SIDE == SIDE - 1) continue
        let y = cells.get(j)!
        let other = cells.get(next)
        if (other == null || Math.abs(other - y) <= 0.48) continue
        let excess = Math.abs(other - y) - 0.48
        let sign = Math.sign(other - y)
        let a = anchors.has(j), b = anchors.has(next)
        if (a && b) continue
        if (!a) cells.set(j, y + sign * excess * (b ? 1 : 0.5))
        if (!b) cells.set(next, other - sign * excess * (a ? 1 : 0.5))
        moved = true
      }
    }
    if (!moved) break
  }
  let lay = (x: number, z: number, h: number) => {
    let i = Math.round(x - at[0]), k = Math.round(z - at[1])
    let best = Infinity, height = 0, cell = -1
    for (let dk = -2; dk <= 2; dk++) {
      for (let di = -2; di <= 2; di++) {
        if (!inside(i + di, k + dk)) continue
        let y = cells.get(index(i + di, k + dk))
        if (y == null) continue
        let dx = x - at[0] - i - di, dz = z - at[1] - k - dk
        let d = Math.hypot(dx, dz)
        if (d < best) best = d, height = y, cell = index(i + di, k + dk)
      }
    }
    if (best >= 2.3) return null
    let blend = Math.min(1, Math.max(0, (2.3 - best) / 1.4))
    let step = NEXT.some((d) => {
      let y = cells.get(cell + d)
      return y != null && Math.abs(y - height) >= 0.2
    })
    return {
      h: h + (height - h) * blend,
      path: best < 0.9,
      step: best < 0.9 && step,
    }
  }
  return { at, cells, doors, lay }
}
