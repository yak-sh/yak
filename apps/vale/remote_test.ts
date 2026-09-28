import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import { follow, type Motion, type Remote } from './remote.ts'

let body = (x: number, vx = 5.6, gait = 'run'): Motion => ({
  x,
  y: 2,
  z: 0,
  yaw: Math.PI / 2,
  vx,
  vz: 0,
  vy: 0,
  gait,
  at: 0,
})

let walk = (arrives: number[]) => {
  let current = body(0), shown: Remote | null = null, points: number[] = []
  for (let t = 0; t <= 1200; t += 20) {
    if (arrives.includes(t)) current = body(t / 1000 * 5.6)
    shown = follow(shown, current, t, 0.02)
    points.push(shown.x)
  }
  return points
}

Deno.test('a peer walking at relay pace keeps moving between packets', () => {
  let points = walk(Array.from({ length: 13 }, (_, i) => i * 100))
  // A ten-Hz relay should look like a walk at sixty-Hz, not ten short dashes.
  for (let i = 8; i < points.length; i++) {
    assert(points[i] > points[i - 1])
    assert(points[i] - points[i - 1] < 0.2)
  }
  assert(points.at(-1)! > 5)
})

Deno.test('a delayed update does not make a walking peer stop or jump', () => {
  let points = walk([0, 100, 200, 1000, 1100, 1200])
  assert(points[35] > points[20] + 1)
  assert(points[45] > points[35])
  for (let i = 1; i < points.length; i++) {
    assert(points[i] >= points[i - 1])
    assert(points[i] - points[i - 1] <= 9.5 * 0.02 + 1e-9)
  }
})

Deno.test('a stop and a campfire teleport do not keep old momentum', () => {
  let moving = follow(null, body(0), 0, 0.02)
  moving = follow(moving, body(1), 200, 0.02)
  let stopped = follow(moving, body(1, 0, 'idle'), 220, 0.02)
  for (let t = 240; t < 1000; t += 20) {
    stopped = follow(stopped, body(1, 0, 'idle'), t, 0.02)
  }
  assertAlmostEquals(stopped.x, 1, 0.01)
  let moved = follow(stopped, body(300, 0, 'idle'), 1000, 0.02)
  assertEquals(moved.x, 300)
  assertEquals(moved.speed, 0)
})
