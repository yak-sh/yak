// Buildings as a walker meets them (solid.ts through sim.ts): a wall stops
// it, a door lets in whoever opens doors and no creature, stairs carry it up,
// and it stands on the floor above the room below. And every kind of
// building, in every land's dress and turned every way, can be walked into
// from outside its door, up every flight, to everywhere something in it is
// used.
import { assert, assertEquals } from '@std/assert'
import { BUILDINGS, dressed, PLANS } from './buildings.ts'
import type { Use } from './buildings/kit.ts'
import type { Vec } from './mesh.ts'
import { type Body, fits, floorAt, walk } from './sim.ts'
import { type Building, within } from './solid.ts'
import { flat, type Vale } from './terrain.ts'

let town = (kind = 'smithy.plaster', turn = 0) =>
  flat(5, [], [{ kind, x: 64, z: 64, seed: 0, turn }])

let body = ([x, y, z]: Vec): Body => ({
  x,
  y,
  z,
  vy: 0,
  yaw: 0,
  speed: 0,
  gait: 'idle',
})

// Walk from `from` toward (x, z) for up to four seconds.
let go = (v: Vale, from: Vec, [x, z]: [number, number], opens = true) => {
  let b = body(from)
  for (let i = 0; i < 240; i++) {
    let dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz)
    if (d < 0.05) break
    b = walk(
      v,
      b,
      { x: dx / d, z: dz / d, jump: false },
      1 / 60,
      4,
      undefined,
      opens,
    )
  }
  return b
}
let use = (b: Building, what: string) => b.uses.find((u) => u.for == what)!
// `m` metres on from a use, the way it faces.
let ahead = (u: Use, m: number): [number, number] => [
  u.at[0] + Math.sin(u.yaw) * m,
  u.at[2] + Math.cos(u.yaw) * m,
]

Deno.test('a wall stops a walker', () => {
  let v = town(), b = v.buildings(64, 64, 0)[0], [, n] = b.foot
  let got = go(v, [b.x - 1.5, 5, n - 3], [b.x - 1.5, b.z])
  assert(got.z < n && got.z > n - 1, `stopped at ${got.z}`)
})

Deno.test('a door lets in whoever opens doors, and no creature', () => {
  let v = town(), b = v.buildings(64, 64, 0)[0], door = use(b, 'door')
  let hero = go(v, door.at, ahead(door, 3))
  assertEquals(within(v, hero.x, hero.y, hero.z), b)
  assertEquals(hero.y, b.floors[0])
  let boar = go(v, door.at, ahead(door, 3), false)
  assertEquals(within(v, boar.x, boar.y, boar.z), null)
})

Deno.test('stairs carry a walker to the floor above', () => {
  let v = town(), b = v.buildings(64, 64, 0)[0], up = use(b, 'up')
  let [x, z] = ahead(up, b.floors[1] - b.floors[0] + 1)
  assertEquals(go(v, up.at, [x, z]).y, b.floors[1])
})

Deno.test('a walker stands on the floor above the room below', () => {
  let v = town(), b = v.buildings(64, 64, 0)[0], down = use(b, 'down')
  let [x, , z] = down.at
  assertEquals(floorAt(v, x, z, b.floors[1]), b.floors[1])
  assertEquals(floorAt(v, x, z, b.floors[0]), b.floors[0])
  let [ax, az] = ahead(down, -1.5)
  assertEquals(go(v, down.at, [ax, az]).y, b.floors[1])
})

// Everywhere a walker can go from `from` a quarter metre at a time, as a
// set of cells by height.
let reach = (v: Vale, from: Vec) => {
  let key = (x: number, y: number, z: number) =>
    `${Math.round(x * 4)} ${Math.round(y * 4)} ${Math.round(z * 4)}`
  let seen = new Set([key(...from)]), todo: Vec[] = [from]
  let [w, n, e, s] = v.buildings(64, 64, 0)[0].box
  while (todo.length) {
    let [x, y, z] = todo.pop()!
    for (let [dx, dz] of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) {
      let nx = x + dx, nz = z + dz
      if (nx < w - 2 || nx > e + 2 || nz < n - 2 || nz > s + 2) continue
      if (!fits(v, nx, nz, y)) continue
      let ny = floorAt(v, nx, nz, y), k = key(nx, ny, nz)
      if (seen.has(k)) continue
      seen.add(k)
      todo.push([nx, ny, nz])
    }
  }
  return (at: Vec) =>
    [0, 0.25, -0.25].some((dx) =>
      [0, 0.25, -0.25].some((dz) =>
        seen.has(key(at[0] + dx, at[1], at[2] + dz))
      )
    )
}

// Every plan in every dress, and turned every way in one.
let ALL: [string, number][] = [
  ...Object.keys(BUILDINGS).map((k): [string, number] => [k, 0]),
  ...Object.keys(PLANS).flatMap((p) =>
    [1, 2, 3].map((t): [string, number] => [dressed(p), t])
  ),
]

Deno.test('every building can be walked into, up, and to all it has', () => {
  for (let [kind, turn] of ALL) {
    let v = town(kind, turn), b = v.buildings(64, 64, 0)[0]
    let got = reach(v, use(b, 'door').at)
    for (let u of b.uses) {
      assert(got(u.at), `${kind} turned ${turn}: where to ${u.for} at ${u.at}`)
    }
  }
})
