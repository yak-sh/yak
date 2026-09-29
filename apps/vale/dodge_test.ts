// A dodge moves in the camera's screen plane while the hero keeps facing.
import { assert, assertAlmostEquals } from '@std/assert'
import type { Intent } from './input.ts'
import type { Bundle, Net } from './net.ts'
import { game } from './play.ts'
import { flat } from './terrain.ts'
import { seedDesigns } from './designs_fixture.ts'
import { seedThemes } from './themes_fixture.ts'
import { seedBuildings } from './buildings_fixture.ts'

seedDesigns()
seedThemes()
seedBuildings()

Deno.test('dodging sideways moves without turning the hero', () => {
  let now = 1000
  let hero: Bundle = {
    entity: { eid: 'hero' },
    player: {},
    position: { level: 'mossvale', x: 70, y: 5, z: 70, at: now },
    motion: { yaw: 1, gait: 'idle', vy: 0, vx: 0, vz: 0 },
  }
  let net = {
    hero: 'hero',
    now: () => now,
    client: {
      ent: () => hero,
      watch: () => ({ value: [] }),
    },
    mine: () => [],
    who: () => null,
    falls: () => [],
    follow: () => {},
    players: () => [],
    settled: () => true,
    keep: () => {},
    move: (changes: Bundle[]) => {
      for (let change of changes) hero = { ...hero, ...change }
    },
    tick: () => {},
  } as unknown as Net
  let still: Intent = {
    move: [0, 0],
    turn: 0,
    faceMove: false,
    jump: false,
    strike: false,
    ability: 0,
    dodge: false,
    talk: false,
    gather: false,
    drink: false,
    snap: false,
    mic: false,
    orbit: [0, 0],
    look: false,
    zoom: 0,
  }
  let play = game(net), v = flat(5)
  let first = play.frame(v, { ...still, move: [1, 0], dodge: true }, 0, 0.1)!
  assert(first.body.x > 70)
  assertAlmostEquals(first.body.yaw, 1)
  now += 200
  let rolling = play.frame(v, still, 0, 0.1)!
  assert(rolling.body.x > first.body.x)
  assertAlmostEquals(rolling.body.yaw, 1)
  now += 300
  let after = play.frame(v, still, 0, 0.1)!
  assertAlmostEquals(after.body.yaw, 1)
})
