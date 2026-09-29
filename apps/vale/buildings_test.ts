// Buildings as a walker meets them (solid.ts through sim.ts): a wall stops
// it, a door lets in whoever opens doors and no creature, stairs carry it up,
// and it stands on the floor above the room below. And every kind of
// building, in every land's dress and turned every way, can be walked into
// from outside its door, up every flight, to everywhere something in it is
// used.
import { assert, assertEquals } from '@std/assert'
import { BUILDINGS } from './buildings.ts'
import type { Use } from './buildings/kit.ts'
import { isA } from './features.ts'
import { homesOf } from './homes.ts'
import { LEVELS } from './levels.ts'
import type { Vec } from './mesh.ts'
import { KINDS, model } from './props.ts'
import { placesOf } from './regions.ts'
import { type Body, fits, floorAt, RADIUS, rest, walk } from './sim.ts'
import { type Building, within } from './solid.ts'
import {
  builtOf,
  flat,
  type Prop,
  spanOf,
  stationsNear,
  type Vale,
  vale,
  WATER,
} from './terrain.ts'
import { seedBeasts } from './beasts_fixture.ts'

seedBeasts()

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

Deno.test('creatures live and wander outside building footprints', () => {
  let v = vale(), room = RADIUS * 2
  let clear = (v: Vale, x: number, z: number) =>
    v.buildings(x, z, room).every((b) =>
      x <= b.foot[0] - room || x >= b.foot[2] + room ||
      z <= b.foot[1] - room || z >= b.foot[3] + room
    )
  for (let id of ['mossvale', 'birchmere', 'fernwood']) {
    let homes = homesOf(id)
    assert(homes.length > 0)
    for (let h of homes) {
      assert(clear(v, ...h.home), `${id}: ${h.kind} lives in a building`)
    }
  }

  let town = flat(5, [], [
    { kind: 'tailor.plaster', x: 64, z: 64, seed: 0 },
    { kind: 'smithy.plaster', x: 96, z: 64, seed: 0 },
  ])
  for (let home of [[64, 52], [96, 52]] as [number, number][]) {
    for (let t of [72_000, 73_000]) {
      let b = rest(town, home, 18, 1, t)
      assertEquals(within(town, b.x, b.y + 1, b.z), null)
      assert(clear(town, b.x, b.z))
    }
  }
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

// Every plan in every dress, turned each way.
let ALL: [string, number][] = Object.keys(BUILDINGS).flatMap((kind) =>
  [0, 1, 2, 3].map((turn): [string, number] => [kind, turn])
)

Deno.test('every building can be walked into, up, and to all it has', () => {
  for (let [kind, turn] of ALL) {
    let v = town(kind, turn), b = v.buildings(64, 64, 0)[0]
    let got = reach(v, use(b, 'door').at)
    for (let u of b.uses) {
      assert(got(u.at), `${kind} turned ${turn}: where to ${u.for} at ${u.at}`)
    }
  }
})

let villages = Object.keys(LEVELS).flatMap((id) =>
  placesOf(id).filter((p) => isA(p.kind, 'village')).map((p) => ({
    id,
    at: p.at,
  }))
)

let size = (p: Prop): [number, number] => {
  let k = KINDS[p.kind], s = spanOf(p)
  return s
    ? [s[0] / 2, s[1] / 2]
    : k.girth
    ? [(k.row ?? 0) + k.girth / 2, k.girth / 2]
    : [k.foot ?? 0, k.foot ?? 0]
}

Deno.test('village buildings leave clear plots for one another and landmarks', () => {
  for (let { id } of villages) {
    let props = builtOf(id)
    for (let b of props.filter((p) => KINDS[p.kind].raise)) {
      let [w, d] = size(b)
      for (let p of props) {
        if (p == b) continue
        let [pw, pd] = size(p)
        assert(
          Math.abs(b.x - p.x) >= w + pw ||
            Math.abs(b.z - p.z) >= d + pd,
          `${id}: ${b.kind} and ${p.kind} overlap`,
        )
      }
    }
  }
})

Deno.test('village crafting stations are inside their workshops', () => {
  let v = vale()
  for (let { id, at: [x, z] } of villages) {
    let stations = stationsNear(v, x, z, 35)
    assertEquals(
      stations.map((s) => s.craft).sort(),
      ['bench', 'cauldron', 'forge', 'loom'],
      id,
    )
    for (let s of stations) {
      let housed = v.buildings(s.x, s.z, 0).some((b) =>
        b.stations.some((inside) =>
          inside.craft == s.craft && inside.x == s.x && inside.z == s.z
        )
      )
      assert(housed, `${id}: ${s.craft} stands outdoors`)
    }
  }
})

Deno.test('the mill stands only beside water', () => {
  let v = vale()
  let mills = Object.keys(LEVELS).flatMap((id) =>
    builtOf(id).filter((p) => p.kind.startsWith('mill.'))
  )
  assertEquals(mills.length, 1)
  let [mill] = mills
  assert(v.rise(mill.x + 5, mill.z) < WATER)
  assert(v.rise(mill.x - 5, mill.z) > WATER)
})

Deno.test('distant buildings draw their shell; other props share a mesh', () => {
  let near = model('smithy.plaster', 0)
  let far = model('smithy.plaster', 0, 0, false)
  assert(far.idx.length < near.idx.length)
  assertEquals(model('well', 0), model('well', 0, 0, false))
})
