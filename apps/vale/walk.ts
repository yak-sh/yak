// A walk through the same ground, stairs, furniture and doors as the hero.
// The world grows from coordinates, so a route can be found once per pair of
// places and shared for as long as that page keeps its world.
import type { Vec } from './mesh.ts'
import { fits, floorAt } from './sim.ts'
import type { Vale } from './terrain.ts'

type Step = {
  i: number
  k: number
  y: number
  cost: number
  score: number
  prev?: Step
}
let routes = new WeakMap<Vale, Map<string, Vec[]>>()
let unit = 0.25
let key = (s: Step) => `${s.i}:${s.k}:${Math.round(s.y / unit)}`
let id = (p: Vec) => p.map((n) => n.toFixed(3)).join(',')

let push = (heap: Step[], s: Step) => {
  let i = heap.length
  heap.push(s)
  while (i) {
    let p = Math.floor((i - 1) / 2)
    if (heap[p].score <= s.score) break
    heap[i] = heap[p]
    i = p
  }
  heap[i] = s
}

let pop = (heap: Step[]): Step => {
  let first = heap[0], last = heap.pop()!
  if (!heap.length) return first
  let i = 0
  while (i * 2 + 1 < heap.length) {
    let c = i * 2 + 1
    if (c + 1 < heap.length && heap[c + 1].score < heap[c].score) c++
    if (heap[c].score >= last.score) break
    heap[i] = heap[c]
    i = c
  }
  heap[i] = last
  return first
}

/** A route from one furnished point to another, found through the walker's
 * collision interface. Every sample is a place a walker can stand. */
export let walk = (v: Vale, from: Vec, to: Vec): Vec[] => {
  if (
    Math.hypot(from[0] - to[0], from[2] - to[2]) < 0.2 &&
    Math.abs(from[1] - to[1]) < 0.2
  ) return [from, to]
  let cache = routes.get(v)
  if (!cache) routes.set(v, cache = new Map())
  let name = `${id(from)}>${id(to)}`
  let found = cache.get(name)
  if (found) return found
  let x = (i: number) => from[0] + i * unit
  let z = (k: number) => from[2] + k * unit
  let x0 = Math.min(from[0], to[0]) - 8
  let x1 = Math.max(from[0], to[0]) + 8
  let z0 = Math.min(from[2], to[2]) - 8
  let z1 = Math.max(from[2], to[2]) + 8
  let away = (i: number, k: number) =>
    Math.abs(x(i) - to[0]) + Math.abs(z(k) - to[2])
  let first: Step = { i: 0, k: 0, y: from[1], cost: 0, score: away(0, 0) }
  let heap = [first], best = new Map([[key(first), first]])
  let ground = new Map<string, number | null>()
  let stand = (i: number, k: number, y: number): number | null => {
    let name = `${i}:${k}:${y}`
    let known = ground.get(name)
    if (known !== undefined) return known
    let px = x(i), pz = z(k), next = floorAt(v, px, pz, y)
    let fit = next <= y + 0.5 && next >= y - 0.75 &&
      fits(v, px, pz, next)
    ground.set(name, fit ? next : null)
    return fit ? next : null
  }
  let end: Step | undefined
  for (let seen = 0; heap.length && seen < 60000; seen++) {
    let s = pop(heap)
    if (best.get(key(s)) != s) continue
    if (
      Math.hypot(x(s.i) - to[0], z(s.k) - to[2]) < 0.3 &&
      Math.abs(s.y - to[1]) < 0.5
    ) {
      end = s
      break
    }
    for (let [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let i = s.i + di, k = s.k + dk, px = x(i), pz = z(k)
      if (px < x0 || px > x1 || pz < z0 || pz > z1) continue
      let y = stand(i, k, s.y)
      if (y == null) continue
      let cost = s.cost + unit + Math.abs(y - s.y) * 0.3
      let next: Step = { i, k, y, cost, score: cost + away(i, k), prev: s }
      let was = best.get(key(next))
      if (was && was.cost <= cost) continue
      best.set(key(next), next)
      push(heap, next)
    }
  }
  // A destination beyond a cliff or water stays unreachable. A villager
  // waits where they stand until they next decide where to go.
  if (!end) {
    cache.set(name, [from])
    return [from]
  }
  let path: Vec[] = [to]
  for (let s: Step | undefined = end; s; s = s.prev) {
    path.push([x(s.i), s.y, z(s.k)])
  }
  path.reverse()
  cache.set(name, path)
  cache.set(`${id(to)}>${id(from)}`, [...path].reverse())
  return path
}
