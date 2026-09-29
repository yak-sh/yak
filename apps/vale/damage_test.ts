// A hero rises at full health when damage is off, ignores a landed bite,
// and can be hurt by the next bite after damage is turned on.
import { assert, assertEquals } from '@std/assert'
import { homesNear } from './homes.ts'
import { type Intent } from './input.ts'
import { type Bundle, type Net } from './net.ts'
import { game } from './play.ts'
import { flat } from './terrain.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

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

Deno.test('damage off revives and protects until damage is turned on', () => {
  let home = homesNear(128, 128, 90).find((h) => h.kind == 'boar')!
  let [x, z] = home.home
  let hero = 'hero'
  let now = 1000
  let rows = new Map<string, Bundle>([
    [hero, {
      entity: { eid: hero },
      player: {},
      damageable: { on: false },
      position: { level: 'mossvale', x, y: 5, z, at: now },
      motion: { yaw: 0, gait: 'down', vy: 0, vx: 0, vz: 0 },
      vitals: { hp: 0, max: 100, lvl: 1 },
    }],
    [home.eid, {
      entity: { eid: home.eid },
      position: { level: home.level, x, y: 5, z, at: now },
      motion: { yaw: 0, gait: 'idle', vy: 0, vx: 0, vz: 0 },
      hunt: { player: hero, bite: 1200 },
    }],
  ])
  let net = {
    client: {
      ent: (eid: string) => rows.get(eid),
      watch: () => ({ value: [] }),
    },
    hero,
    now: () => now,
    mine: () => [],
    who: () => null,
    falls: () => [],
    follow: () => {},
    players: () => [],
    settled: () => true,
    keep: () => {},
    move: (bundles: Bundle[]) => {
      for (let b of bundles) {
        rows.set(b.entity.eid, { ...rows.get(b.entity.eid), ...b })
      }
    },
    tick: () => {},
  } as unknown as Net
  let play = game(net)
  let v = flat(5)

  let risen = play.frame(v, still, 0, 0.016)!
  assertEquals(risen.down, false)
  assertEquals(risen.body.gait, 'idle')
  assertEquals(risen.vitals.hp, risen.vitals.max)
  now = 1300
  let guarded = play.frame(v, still, 0, 0.016)!
  assertEquals(guarded.vitals.hp, guarded.vitals.max)
  assertEquals(guarded.events.some((e) => e.type == 'hurt'), false)

  rows.set(hero, { ...rows.get(hero)!, damageable: { on: true } })
  rows.set(home.eid, {
    ...rows.get(home.eid)!,
    hunt: { player: hero, bite: 1500 },
  })
  now = 1400
  play.frame(v, still, 0, 0.016)
  now = 1600
  let exposed = play.frame(v, still, 0, 0.016)!
  assert(exposed.vitals.hp < exposed.vitals.max)
  assert(exposed.events.some((e) => e.type == 'hurt'))
})
