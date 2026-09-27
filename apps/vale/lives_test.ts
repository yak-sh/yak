// Villagers find the furnishings of placed buildings and walk through their
// doors and stairs under the same collision rules as the hero.
import { assert, assertEquals } from '@std/assert'
import { lifeOf } from './lives.ts'
import { GIVERS } from './quests.ts'
import { fits } from './sim.ts'
import { stationsNear, vale } from './terrain.ts'
import { walk } from './walk.ts'

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
