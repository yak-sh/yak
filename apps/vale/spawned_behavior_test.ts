// Explicitly placed creatures wander and fight even inside village shelter;
// shelter still keeps the den creatures out.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { useBeasts } from './beasts.ts'
import { comp } from './bundle.ts'
import { rows as beasts } from './beasts_fixture.ts'
import { seedDesigns } from './designs_fixture.ts'
import { useFigures } from './figure.ts'
import { rows as figures } from './figures_fixture.ts'
import type { Intent } from './input.ts'
import type { Bundle, Net } from './net.ts'
import { game } from './play.ts'
import { rest, sheltered } from './sim.ts'
import { homeOf, useSpawnKinds } from './spawn.ts'
import { vale } from './terrain.ts'

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

// The reported spawn's home, salt and combat, with a ready figure. Geometry
// does not decide whether the simulation lets it move or acquire a quarry.
let spawn: Bundle = {
  entity: { eid: '798d6a82-9713-4e2b-a395-bd1e994e366c' },
  spawned: { lvl: 1, x: 134, z: 134, roam: 2 },
  place: { level: 'mossvale' },
}
let kind = '87aa79a1-4cf3-48f9-8386-5796abfda2d4'

let install = () => {
  seedDesigns()
  useBeasts([...beasts, {
    entity: { eid: kind },
    beast_design: { name: 'Topspin' },
    combat: {
      lvl: 1,
      hp: 36,
      dmg: 3,
      speed: 2,
      reach: 1,
      aggro: 3,
      xp: 12,
    },
  }])
  useFigures([...figures, {
    entity: { eid: 'figure' },
    figure: { ...figures[0].figure, of: kind },
  }])
  useSpawnKinds([
    {
      entity: { eid: kind },
      built: { current: true, slot: 'kind', build: 'build' },
    },
    {
      entity: { eid: 'build' },
      build: { variant: 'main', for: spawn.entity.eid },
    },
  ])
}

test('a generated spawn wanders, chases and bites within village shelter', () => {
  install()
  try {
    let v = vale(), now = 1000, hero = 'hero'
    assert(sheltered(v, 134, 134))
    let home = homeOf(spawn)!
    // Den wandering retains its shelter boundary.
    assertEquals(rest(v, home.home, home.roam, home.seed, now).speed, 0)
    let rows = new Map<string, Bundle>([[hero, {
      entity: { eid: hero },
      player: {},
      damageable: { on: true },
      position: { level: 'mossvale', x: 142, y: 6.25, z: 134, at: now },
      motion: { yaw: 0, gait: 'idle', vy: 0, vx: 0, vz: 0 },
      vitals: { hp: 100, max: 100, lvl: 1 },
    }]])
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
      spawned: () => [spawn],
      follow: () => {},
      players: () => [],
      settled: () => true,
      keep: () => {},
      tick: () => {},
      move: (bundles: Bundle[]) => {
        for (let b of bundles) {
          rows.set(b.entity.eid, { ...rows.get(b.entity.eid), ...b })
        }
      },
    } as unknown as Net
    let play = game(net)
    let frame = () => play.frame(v, still, 0, 0.016)!
    let mob = (f: ReturnType<typeof frame>) =>
      f.mobs.find((m) => m.eid == spawn.entity.eid)!
    let first = mob(frame())
    now = 5000
    let next = mob(frame())
    assert(next.body.speed > 0)
    assertNotEquals([first.body.x, first.body.z], [next.body.x, next.body.z])
    // Re-open next to it, while both still stand in shelter.
    rows.set(hero, {
      ...rows.get(hero)!,
      position: {
        level: 'mossvale',
        x: 132,
        y: 6.25,
        z: 134,
        at: now,
      },
    })
    play = game(net)
    let chased = mob(frame())
    assertEquals(comp(rows.get(spawn.entity.eid), 'hunt').player, hero)
    assert(chased.body.speed > 0)
    let hp = frame().vitals.hp
    let hurt = false
    for (let i = 0; i < 400 && !hurt; i++) {
      now += 16
      hurt = frame().vitals.hp < hp
    }
    assert(hurt, 'the spawned creature must land its bite inside shelter')
  } finally {
    seedDesigns()
    useSpawnKinds([])
  }
})
