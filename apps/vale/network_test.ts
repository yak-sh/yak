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
  walk: false,
  snap: false,
  mic: false,
  orbit: [0, 0],
  look: false,
  zoom: 0,
}

test('peer relays leave my hero in place and several creatures chasing', async () => {
  seedDesigns()
  using time = new FakeTime()
  let vocab = loadVocab([words, core])
  let store = graph({ storage: ram(vocab), vocab })
  let heroes = ['a-hero', 'b-hero', 'c-hero']
  let mobs = ['first-mob', 'second-mob', 'third-mob', 'fourth-mob']
  store.apply([
    ...heroes.flatMap((eid) => [
      { entity: { eid }, player: {} },
      {
        entity: { eid: `look-${eid}` },
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
    authenticate: () => ({ by: 'person' }),
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
  try {
    await time.tickAsync(0)
    await Promise.all(pages.map((p) => p.net.settle()))
    for (let p of pages) {
      p.net.move([{
        entity: { eid: p.eid },
        position: { level: 'mossvale', x: 64, y: 5, z: 68, at: Date.now() },
        motion: { yaw: 0, gait: 'idle', vx: 0, vz: 0, vy: 0 },
      }])
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
  } finally {
    for (let p of pages) p.page.close()
  }
})
