// The combat event boundary keeps an ability with its delayed landing and
// the start of a step, where the renderer needs them.
import { assert, assertEquals } from '@std/assert'
import { homesOf } from './homes.ts'
import type { Intent } from './input.ts'
import type { Net } from './net.ts'
import { type Event, game } from './play.ts'
import { flat } from './terrain.ts'

let encounter = (item: string, gap: number) => {
  let home = homesOf('mossvale').find((h) => h.kind == 'wolf')!
  let [x, z] = home.home
  let rows: Record<string, Record<string, unknown>> = {
    hero: {
      entity: { eid: 'hero' },
      position: { level: home.level, x, y: 0, z: z - gap, at: 10000 },
      motion: { yaw: 0, gait: 'idle', vy: 0 },
    },
    [home.eid]: {
      entity: { eid: home.eid },
      position: { level: home.level, x, y: 0, z, at: 10000 },
      motion: { yaw: 0, gait: 'idle', vy: 0 },
    },
  }
  let clock = 10000
  let net = {
    hero: 'hero',
    now: () => clock,
    client: {
      ent: (eid: string) => rows[eid],
      watch: () => ({ value: [] }),
    },
    mine: (component: string) =>
      component == 'item'
        ? [{
          entity: { eid: 'weapon' },
          item: { player: 'hero', kind: item, n: 1, at: 1 },
        }]
        : component == 'equip'
        ? [{
          entity: { eid: 'worn' },
          equip: { player: 'hero', slot: 'main', item: 'weapon', at: 2 },
        }]
        : [],
    who: () => ({ name: 'Tester' }),
    players: () => [],
    falls: () => [],
    nearReady: () => false,
    settled: () => false,
    follow: () => {},
    move: (changes: { entity: { eid: string }; [key: string]: unknown }[]) => {
      for (let { entity, ...components } of changes) {
        rows[entity.eid] = { ...rows[entity.eid], entity, ...components }
      }
    },
    tick: () => {},
    keep: () => {},
  } as unknown as Net
  let play = game(net)
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
  let frame = (ms: number, action: Partial<Intent> = {}): Event[] => {
    clock = ms
    let f = play.frame(flat(0), { ...still, ...action }, 0, 0)
    assert(f)
    return f.events
  }
  return { frame, home }
}

Deno.test('Quake chips land on the creatures it hits', () => {
  let { frame } = encounter('hammer1', 2)
  let cast = frame(10000, { ability: 1 })
  assert(cast.some((e) => e.type == 'ability' && e.id == 'quake'))
  let hit = frame(10600).find((e) => e.type == 'hit')
  assert(hit && hit.type == 'hit')
  assertEquals(hit.by, 'quake')
})

Deno.test('Shadowstep carries its route to the visual effect', () => {
  let { frame } = encounter('dagger1', 5)
  let cast = frame(10000, { ability: 2 }).find((e) => e.type == 'ability')
  assert(cast && cast.type == 'ability')
  assertEquals(cast.id, 'shadowstep')
  assert(cast.from)
  assert(Math.hypot(cast.from[0] - cast.at[0], cast.from[2] - cast.at[2]) > 2)
})
