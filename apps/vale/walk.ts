// A walk through the same ground, stairs, furniture and doors as the hero.
// The world grows from coordinates, so a route can be found once per pair of
// places and shared for as long as that page keeps its world.
import { aStar } from '@yaks/game'
import type { Vec } from '@yaks/voxel/mesh'
import { fits, floorAt } from './sim.ts'
import type { Vale } from './terrain.ts'

type Step = {
  i: number
  k: number
  y: number
}
let routes = new WeakMap<Vale, Map<string, Vec[]>>()
let unit = 0.25
let key = (s: Step) => `${s.i}:${s.k}:${Math.round(s.y / unit)}`
let id = (p: Vec) => p.map((n) => n.toFixed(3)).join(',')

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
  let first: Step = { i: 0, k: 0, y: from[1] }
  let close = (i: number, k: number) =>
    Math.hypot(x(i) - to[0], z(k) - to[2]) < 0.3
  let arrived = (s: Step) => close(s.i, s.k) && Math.abs(s.y - to[1]) < 0.5
  let unreachable = () => {
    cache.set(name, [from])
    return [from]
  }
  // Every arriving step needs support within the goal's height tolerance.
  // Asking above that interval bounds all its possible floors from above;
  // higher or blocked floors still go through the ordinary search.
  let supported = () => {
    if (arrived(first)) return true
    let i0 = Math.floor((to[0] - from[0] - 0.3) / unit)
    let i1 = Math.ceil((to[0] - from[0] + 0.3) / unit)
    let k0 = Math.floor((to[2] - from[2] - 0.3) / unit)
    let k1 = Math.ceil((to[2] - from[2] + 0.3) / unit)
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        if (close(i, k) && floorAt(v, x(i), z(k), to[1] + 0.5) > to[1] - 0.5) {
          return true
        }
      }
    }
    return false
  }
  if (!supported()) return unreachable()
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
  let steps = aStar({
    from: first,
    key,
    goal: arrived,
    heuristic: (s) => away(s.i, s.k),
    limit: 60000,
    neighbours: function* (s) {
      for (let [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let i = s.i + di, k = s.k + dk, px = x(i), pz = z(k)
        if (px < x0 || px > x1 || pz < z0 || pz > z1) continue
        let y = stand(i, k, s.y)
        if (y == null) continue
        yield { node: { i, k, y }, cost: unit + Math.abs(y - s.y) * 0.3 }
      }
    },
  })
  // A destination beyond a cliff or water stays unreachable. A villager
  // waits where they stand until they next decide where to go.
  if (!steps) return unreachable()
  let path: Vec[] = steps.map((s) => [x(s.i), s.y, z(s.k)])
  path.push(to)
  cache.set(name, path)
  cache.set(`${id(to)}>${id(from)}`, [...path].reverse())
  return path
}
