// Villagers find the furnishings of placed buildings and walk through their
// doors and stairs under the same collision rules as the hero.
import { assert, assertEquals } from '@std/assert'
import { lifeOf } from './lives.ts'
import { GIVERS } from './quests.ts'
import { fits } from './sim.ts'
import { stationsNear, vale } from './terrain.ts'
import { STATIONS } from './craft.ts'
import { walk } from './walk.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

Deno.test('the tailor works beside the loom and can walk there from home', () => {
  let v = vale(), elsie = GIVERS.find((g) => g.id == 'elsie')!
  let life = lifeOf(elsie, v), loom = life.work!
  let station = stationsNear(v, loom[0], loom[2], 2)
    .find((s) => s.craft == 'loom')
  assert(station)
  assert(Math.hypot(loom[0] - station.x, loom[2] - station.z) < 2)
  let path = walk(v, life.home, loom)
  assert(path.length > 2)
  assertEquals(path[0], life.home)
  assertEquals(path.at(-1), loom)
  for (let [x, y, z] of path) assert(fits(v, x, z, y))
})

Deno.test('smith and tailor work to the side while the station stays open', () => {
  let v = vale()
  for (let [id, craft] of [['rowan', 'forge'], ['elsie', 'loom']] as const) {
    let g = GIVERS.find((g) => g.id == id)!
    let life = lifeOf(g, v), work = life.work!
    let station = stationsNear(v, work[0], work[2], 3)
      .find((s) => s.craft == craft)!
    let use = v.buildings(station.x, station.z, 4)
      .flatMap((b) => b.uses)
      .find((u) =>
        u.for == 'work' &&
        Math.hypot(u.at[0] - station.x, u.at[2] - station.z) < 2
      )!
    assert(fits(v, work[0], work[2], work[1]))
    assert(Math.hypot(work[0] - use.at[0], work[2] - use.at[2]) > 1)
    assert(
      Math.hypot(work[0] - station.x, work[2] - station.z) <
        STATIONS[craft].reach,
    )
    assert(walk(v, life.home, work).length > 2)
  }
})

Deno.test('villagers sharing a village have separate places to rest and meet', () => {
  let v = vale()
  for (let id of ['wren', 'pip']) {
    assert(lifeOf(GIVERS.find((g) => g.id == id)!, v).inn)
  }
  let locals = GIVERS.filter((g) =>
    g.level == 'mossvale' || g.level == 'birchmere'
  )
  for (let place of ['home', 'inn'] as const) {
    let stands = locals.flatMap((g) => {
      let p = lifeOf(g, v)[place]
      return p ? [{ g, p }] : []
    })
    for (let i = 0; i < stands.length; i++) {
      let a = stands[i]
      assert(fits(v, a.p[0], a.p[2], a.p[1]))
      for (let b of stands.slice(i + 1)) {
        if (a.g.level != b.g.level) continue
        assert(Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]) >= 1.1)
      }
    }
  }
})
