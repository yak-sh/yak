// Paths are searched and followed over values; courses retain chord sampling
// independently of a game's terrain and seeded bending policy.
import { equal, ok, test } from '@yaks/testing'
import {
  advance,
  along,
  alongCourse,
  aStar,
  clearOfCourse,
  course,
  nearCourse,
  offCourse,
  partCourse,
  type PathPoint,
} from './path.ts'

test('A* replaces expensive routes and ignores stale queue entries', () => {
  let edges: Record<string, [string, number][]> = {
    start: [['slow', 9], ['detour', 1]],
    detour: [['slow', 1]],
    slow: [['goal', 20], ['start', 0]],
    goal: [],
  }
  let visited: string[] = []
  let path = aStar({
    from: 'start',
    key: (n) => n,
    goal: (n) => n == 'goal',
    heuristic: () => 0,
    neighbours: (n) => {
      visited.push(n)
      return edges[n].map(([node, cost]) => ({ node, cost }))
    },
  })
  equal(path, ['start', 'detour', 'slow', 'goal'])
  equal(visited, ['start', 'detour', 'slow'])
})

test('A* reopens nodes with a better route and an admissible heuristic', () => {
  let edges: Record<string, [string, number][]> = {
    a: [['b', 3], ['c', 1]],
    b: [['goal', 3]],
    c: [['b', 1]],
    goal: [],
  }
  equal(
    aStar({
      from: 'a',
      key: (n) => n,
      goal: (n) => n == 'goal',
      neighbours: (n) => edges[n].map(([node, cost]) => ({ node, cost })),
      heuristic: (n) => n == 'c' ? 4 : 0,
    }),
    ['a', 'c', 'b', 'goal'],
  )
})

test('A* accepts caller-defined keys, goals, bounds and unreachable nodes', () => {
  let search = {
    from: { x: 0 },
    key: (p: { x: number }) => p.x,
    goal: (p: { x: number }) => p.x == 2,
    neighbours: (p: { x: number }) =>
      [-1, 1].map((d) => ({ node: { x: p.x + d }, cost: 1 }))
        .filter(({ node }) => node.x >= 0 && node.x <= 3),
    heuristic: (p: { x: number }) => Math.abs(2 - p.x),
  }
  equal(aStar(search), [{ x: 0 }, { x: 1 }, { x: 2 }])
  equal(aStar({ ...search, limit: 2 }), null)
  equal(aStar({ ...search, goal: (p) => p.x == 4 }), null)
  equal(aStar({ ...search, goal: () => true }), [{ x: 0 }])
})

test('along samples three-dimensional distance through repeated points', () => {
  let path: PathPoint[] = [[0, 0, 0], [0, 0, 0], [0, 3, 4], [3, 3, 4]]
  equal(along(path, -1), [0, 0, 0])
  equal(along(path, 2.5), [0, 1.5, 2])
  equal(along(path, 5), [0, 3, 4])
  equal(along(path, 6.5), [1.5, 3, 4])
  equal(along(path, 100), [3, 3, 4])
  equal(along([[1, 2, 3]], 5), [1, 2, 3])
})

test('advance consumes horizontal distance across corners without mutating inputs', () => {
  let from: PathPoint = [0, 0, 0]
  let path: PathPoint[] = [[0, 0, 0], [1, 2, 0], [1, 4, 2]]
  let moved = advance(from, path, 1, 2)
  equal(moved.at, [1, 3, 1])
  equal(moved.path, [[1, 4, 2]])
  equal(moved.speed, Math.SQRT2)
  equal(from, [0, 0, 0])
  equal(path, [[0, 0, 0], [1, 2, 0], [1, 4, 2]])
  equal(advance(moved.at, moved.path, 1, 2), {
    at: [1, 4, 2],
    path: [],
    speed: 1,
  })
})

test('advance handles no movement, vertical points and a caller-defined snap', () => {
  let from: PathPoint = [0, 0, 0]
  let path: PathPoint[] = [[0, 3, 0], [0.1, 3, 0], [1, 3, 0]]
  equal(advance(from, path, 0, 2), { at: from, path, speed: 0 })
  equal(advance(from, path, -1, 2), { at: from, path, speed: 0 })
  equal(advance(from, [], 1, 2), { at: from, path: [], speed: 0 })
  equal(advance(from, path, 1, 0), { at: from, path, speed: 0 })
  equal(advance(from, path, 0.25, 2, 0.15), {
    at: [0.6, 3, 0],
    path: [[1, 3, 0]],
    speed: 2.4,
  })
})

test('courses sample caller offsets and retain bounds and chord projection', () => {
  let c = course([0, 0], [4, 0], (t) => t == 0.5 ? 2 : 0)
  equal([...c.xs], [0, 1, 2, 3, 4])
  equal([...c.zs], [0, 0, 2, 0, 0])
  equal(c.box, [0, 0, 4, 2])
  equal(alongCourse(c, 2, 100), 0.5)
  equal(alongCourse(c, -1, 0), 0)
  equal(alongCourse(c, 5, 0), 1)
  equal(offCourse(c, 2, 3, 0.5), 1)
  equal(offCourse(c, 2.5, 1, 0.625), 0)
  equal(offCourse(c, 5, 0, 1), 1)
  let part = partCourse(c, 1, 4)
  equal([...part.xs], [1, 2, 3])
  equal([...part.zs], [0, 2, 0])
  equal(part.a, [1, 0])
  equal([part.dx, part.dz], [2, 0])
  equal(part.box, [1, 0, 3, 2])
  equal(offCourse(part, 2, 2, 0.5), 0)
})

test('course proximity rejects by bounds and clears rectangular plots by samples', () => {
  let c = course([0, 0], [4, 0])
  ok(nearCourse(c, 2, 0.5, 1))
  equal(nearCourse(c, 2, 1, 1), false)
  equal(clearOfCourse(c, 2, 0, 0.5, 0.5, 1), false)
  ok(clearOfCourse(c, 2, 3, 0.5, 0.5, 1))
  let same = course([2, 3], [2, 3])
  equal(alongCourse(same, 2, 3), 0)
  equal(offCourse(same, 2, 3, 0), 0)
})
