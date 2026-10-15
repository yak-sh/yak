// Path search and following, and sampled two-dimensional courses. Callers
// supply neighbours, costs and course offsets; no world or graph is read here.

/** One reachable node and the non-negative cost of reaching it. */
export type SearchEdge<T> = { node: T; cost: number }

/** A* inputs. Keys identify equivalent nodes; the heuristic must not
 * overestimate the remaining cost if the shortest path is required. */
export type Search<T, K> = {
  from: T
  key: (node: T) => K
  goal: (node: T) => boolean
  neighbours: (node: T) => Iterable<SearchEdge<T>>
  heuristic: (node: T) => number
  limit?: number
}

type Step<T> = { node: T; cost: number; score: number; prev?: Step<T> }

let push = <T>(heap: Step<T>[], s: Step<T>) => {
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

let pop = <T>(heap: Step<T>[]): Step<T> => {
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

/** Find a path including both endpoints, or null when unreachable or when
 * the pop limit is exhausted. A better route reopens a previously seen node. */
export let aStar = <T, K>(
  { from, key, goal, neighbours, heuristic, limit = Infinity }: Search<T, K>,
): T[] | null => {
  let first: Step<T> = { node: from, cost: 0, score: heuristic(from) }
  let heap = [first], best = new Map([[key(from), first]])
  for (let seen = 0; heap.length && seen < limit; seen++) {
    let s = pop(heap)
    if (best.get(key(s.node)) != s) continue
    if (goal(s.node)) {
      let path: T[] = []
      for (let at: Step<T> | undefined = s; at; at = at.prev) path.push(at.node)
      return path.reverse()
    }
    for (let { node, cost: edge } of neighbours(s.node)) {
      let cost = s.cost + edge, id = key(node)
      let was = best.get(id)
      if (was && was.cost <= cost) continue
      let next: Step<T> = { node, cost, score: cost + heuristic(node), prev: s }
      best.set(id, next)
      push(heap, next)
    }
  }
  return null
}

/** A point in three-dimensional space, ordered x, y, z. */
export type PathPoint = [number, number, number]

/** Sample a nonempty path by three-dimensional distance, clamping to its
 * endpoints. Repeated points contribute no distance. */
export let along = (path: readonly PathPoint[], metres: number): PathPoint => {
  if (metres <= 0) return path[0]
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1], b = path[i]
    let span = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    if (metres < span && span) {
      let k = metres / span
      return [
        a[0] + (b[0] - a[0]) * k,
        a[1] + (b[1] - a[1]) * k,
        a[2] + (b[2] - a[2]) * k,
      ]
    }
    metres -= span
  }
  return path.at(-1)!
}

/** Consume a horizontal distance budget (pace * dt), interpolating height.
 * Points within snap metres are consumed without spending distance. Inputs
 * are not mutated; speed is horizontal displacement per second, not pace. */
export let advance = (
  from: PathPoint,
  path: PathPoint[],
  dt: number,
  pace: number,
  snap = 0,
): { at: PathPoint; path: PathPoint[]; speed: number } => {
  let left = Math.max(0, dt) * Math.max(0, pace)
  let at = from
  while (path.length && left > 0) {
    let to = path[0]
    let d = Math.hypot(to[0] - at[0], to[2] - at[2])
    if (d == 0 || d < snap) {
      at = to
      path = path.slice(1)
    } else {
      let k = Math.min(1, left / d)
      at = [
        at[0] + (to[0] - at[0]) * k,
        at[1] + (to[1] - at[1]) * k,
        at[2] + (to[2] - at[2]) * k,
      ]
      left -= d * k
      if (k == 1) path = path.slice(1)
    }
  }
  return {
    at,
    path,
    speed: dt > 0 ? Math.hypot(at[0] - from[0], at[2] - from[2]) / dt : 0,
  }
}

/** A two-dimensional polyline sampled uniformly along its endpoint chord.
 * xs and zs have at least two samples; box bounds all samples. */
export type Course = {
  a: [number, number]
  dx: number
  dz: number
  xs: Float64Array
  zs: Float64Array
  box: [number, number, number, number]
}

/** Sample a chord every metre, displaced perpendicular to it by offset(t).
 * The caller supplies any bend/noise policy. */
export let course = (
  a: [number, number],
  b: [number, number],
  offset: (t: number) => number = () => 0,
): Course => {
  let dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1
  let n = Math.ceil(len) + 1
  let xs = new Float64Array(n), zs = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let t = i / (n - 1), w = offset(t)
    xs[i] = a[0] + dx * t - (dz / len) * w
    zs[i] = a[1] + dz * t + (dx / len) * w
  }
  return {
    a,
    dx,
    dz,
    xs,
    zs,
    box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
  }
}

/** A course's sample interval, retaining at least two samples. */
export let partCourse = (c: Course, lo: number, hi = c.xs.length): Course => {
  let xs = c.xs.slice(lo, hi), zs = c.zs.slice(lo, hi)
  if (xs.length < 2) throw new RangeError('A course needs at least two samples')
  return {
    a: [xs[0], zs[0]],
    dx: xs.at(-1)! - xs[0],
    dz: zs.at(-1)! - zs[0],
    xs,
    zs,
    box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
  }
}

/** A bounding-box rejection test, not an exact distance test. */
export let nearCourse = ({ box }: Course, x: number, z: number, r: number) =>
  x > box[0] - r && x < box[2] + r && z > box[1] - r && z < box[3] + r

/** Whether a rectangle with half extents w,d clears the samples by room.
 * Half a metre accounts for the space between metre-spaced samples. */
export let clearOfCourse = (
  c: Course,
  x: number,
  z: number,
  w: number,
  d: number,
  room: number,
): boolean =>
  !nearCourse(c, x, z, Math.max(w, d) + room) ||
  !c.xs.some((a, i) =>
    Math.hypot(
      Math.max(0, Math.abs(a - x) - w),
      Math.max(0, Math.abs(c.zs[i] - z) - d),
    ) < room + 0.5
  )

/** Project onto the endpoint chord, clamped to 0..1 (not arc length). */
export let alongCourse = (c: Course, x: number, z: number): number => {
  let length2 = c.dx * c.dx + c.dz * c.dz
  return length2
    ? Math.min(
      1,
      Math.max(0, ((x - c.a[0]) * c.dx + (z - c.a[1]) * c.dz) / length2),
    )
    : 0
}

/** Distance from (x,z) to the sample interpolation at chord fraction t. */
export let offCourse = (c: Course, x: number, z: number, t: number): number => {
  let f = Math.min(1, Math.max(0, t)) * (c.xs.length - 1)
  let i = Math.min(c.xs.length - 2, Math.floor(f)), u = f - i
  return Math.hypot(
    x - (c.xs[i] + (c.xs[i + 1] - c.xs[i]) * u),
    z - (c.zs[i] + (c.zs[i + 1] - c.zs[i]) * u),
  )
}
