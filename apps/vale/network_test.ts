// Several pages share a level through the same store and socket doors used
// by the game. One elected page must move several creatures without losing
// its own hero or interrupting a hunt.
import { equal, test } from '@yaks/testing'
import { assert } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { api } from '@yaks/api'
import { loadVocab } from '@yaks/vocab'
import { pair } from '../../packages/sync/testing.ts'
import core from '../../packages/kernel/vocab.json' with { type: 'json' }
import words from './vocab.json' with { type: 'json' }
import { connect } from './net.ts'
import { game } from './play.ts'
import { comp } from './bundle.ts'
import { flat } from './terrain.ts'
import { placeOf } from './area.ts'
import { seedDesigns } from './designs_fixture.ts'
import type { Intent } from './input.ts'

let idle: Intent = {
  move: [0, 0],
  turn: 0,
  faceMove: false,
  jump: false,
  strike: false,
  ability: 0,
  dodge: false,
  drink: false,
  talk: false,
  gather: false,
  snap: false,
  mic: false,
  orbit: [0, 0],
  look: false,
  zoom: 0,
}

let peers = () => {
  seedDesigns()
  let vocab = loadVocab([words, core])
  let store = graph({ storage: ram(vocab), vocab })
  let heroes: string[] = Array.from({ length: 3 }, () => crypto.randomUUID())
    .sort()
  let mobs = Array.from({ length: 4 }, () => crypto.randomUUID())
  let person = crypto.randomUUID()
  store.apply([
    ...heroes.flatMap((eid) => [
      { entity: { eid }, player: {} },
      {
        entity: { eid: crypto.randomUUID() },
        look: { player: eid, name: eid, at: 0 },
      },
    ]),
    ...mobs.map((eid) => ({
      entity: { eid },
      spawned: {
        beast: 'f478578e-da3f-81a2-b7a9-4c80c2adb500',
        x: 64,
        z: 64,
        roam: 0,
        lvl: 2,
      },
      place: placeOf(64, 64),
    })),
  ])
  let sockets: ReturnType<typeof pair>['server'][] = []
  let serve = api({
    graph: store,
    authenticate: () => ({ by: person }),
    upgrade: () => ({
      socket: sockets.shift()!,
      response: new Response(null, { status: 101 }),
    }),
  })
  let pages = heroes.map((eid) => {
    let page = connect(new URL('http://vale.test/'), vocab, {
      fetch: (r) => serve(r),
      connect: () => {
        let both = pair()
        sockets.push(both.server)
        Promise.resolve(serve(
          new Request('http://vale.test/ws', {
            headers: { upgrade: 'websocket' },
          }),
        )).then(() => {
          both.server.emit('open')
          both.client.emit('open')
        })
        return both.client
      },
    })
    let net = page.world()
    net.follow(64, 64)
    net.choose(eid)
    return { page, net, play: game(net), eid }
  })
  return {
    pages,
    heroes,
    mobs,
    [Symbol.dispose]: () => {
      for (let p of pages) p.page.close()
    },
  }
}

let stand = (
  p: ReturnType<typeof peers>['pages'][number],
  x: number,
  z: number,
) =>
  p.net.move([{
    entity: { eid: p.eid },
    position: { level: 'mossvale', x, y: 5, z, at: Date.now() },
    motion: { yaw: 0, gait: 'idle', vx: 0, vz: 0, vy: 0 },
  }])

test('peer relays leave my hero in place and several creatures chasing', async () => {
  using time = new FakeTime()
  using group = peers()
  let { pages, heroes, mobs } = group
  await time.tickAsync(0)
  await Promise.all(pages.map((p) => p.net.settle()))
  for (let p of pages) {
    stand(p, 64, 68)
  }
  await time.tickAsync(200)
  let v = flat(5)
  for (let step = 0; step < 240; step++) {
    for (let p of pages) {
      let f = p.play.frame(v, idle, 0, 0.016)!
      equal([f.body.x, f.body.z], [64, 68])
      if (step > 20) equal(f.others.length, 2)
    }
    await time.tickAsync(16)
  }
  for (let p of pages) {
    for (let eid of mobs) {
      assert(
        heroes.includes(String(comp(p.page.client.ent(eid), 'hunt').player)),
      )
    }
  }
})

test('an elected peer keeps chasing a retreating hero until the home leash', async () => {
  using time = new FakeTime()
  using group = peers()
  let { pages, mobs } = group
  let [owner, runner, witness] = pages
  await time.tickAsync(0)
  await Promise.all(pages.map((p) => p.net.settle()))
  // Only the runner is inside the authored five-metre wake radius. The
  // first hero owns the creatures from across the clearing.
  stand(owner, 44, 64)
  stand(runner, 64, 68)
  stand(witness, 44, 70)
  await time.tickAsync(200)
  let v = flat(5)
  let step = async (moving = false) => {
    let frames = pages.map((p) =>
      p.play.frame(
        v,
        {
          ...idle,
          move: moving && p == runner ? [0, 1] : [0, 0],
        },
        Math.PI,
        0.016,
      )!
    )
    await time.tickAsync(16)
    return frames
  }
  let hunts = () => {
    for (let p of pages) {
      for (let eid of mobs) {
        equal(comp(p.page.client.ent(eid), 'hunt').player, runner.eid)
      }
    }
  }
  for (let i = 0; i < 20; i++) await step()
  hunts()
  let frames = await step(true)
  for (let i = 0; i < 180; i++) frames = await step(true)
  assert(
    frames[1].body.z > 80,
    'the hero retreated well beyond the wake radius',
  )
  hunts()
  // A second hero walking closer must not steal an undamaged creature's
  // quarry. The runner stops and the creatures catch up.
  stand(witness, 64, 64)
  witness.play = game(witness.net)
  for (let i = 0; i < 240; i++) frames = await step()
  hunts()
  for (let eid of mobs) {
    assert(Number(comp(owner.page.client.ent(eid), 'position').z) > 76)
  }
  // Going beyond the existing home leash ends the pursuit on every page.
  for (let i = 0; i < 200; i++) frames = await step(true)
  assert(frames[1].body.z > 90)
  for (let p of pages) {
    for (let eid of mobs) {
      assert(comp(p.page.client.ent(eid), 'hunt').player != runner.eid)
    }
  }
})
