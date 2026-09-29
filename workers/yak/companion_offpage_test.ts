// A Vale objective, from the person's command through the app Store's wake
// and worker, while no page runs. Only Jev's outside answer is scripted.
import { assert, assertEquals } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { flat } from '../../apps/vale/terrain.ts'
import { workerOf } from '../../apps/vale/worker.js'
import { appStore, storeName } from './directory.ts'
import { runCommand } from './declared.ts'
import { commandWorker, granted } from './dispatch.ts'
import { Store } from './graph.ts'
import { parseTools } from '@yaks/tools/declared'
import { ADA, ADA_OWNS, platform, seeded } from './serving-probe.ts'
import type { Dispatch } from './door.ts'

let SECOND = 'b0000000-0000-4000-8000-000000000002'
let read = (door: ReturnType<typeof appStore>, line: string, who = ADA_OWNS) =>
  door(`/query?q=${encodeURIComponent(line)}`, {}, who).then((r) => r.json())

Deno.test('a companion works off-page across pause, restart and retry', async () => {
  using time = new FakeTime('2026-09-28T00:00:00.000Z')
  using p = platform()
  let k = await seeded(p.env)
  let name = storeName(k.space, k.app)
  let door = appStore(p.env.STORE, k.space, k.app)
  let write = async (path: string, body: unknown) => {
    let res = await door(path, {
      method: 'POST',
      body: JSON.stringify(
        path == '/apply' ? (body as { entities: unknown[] }).entities : body,
      ),
    }, ADA_OWNS)
    assertEquals(res.status, 200, await res.text())
  }
  let words = JSON.parse(Deno.readTextFileSync(
    new URL('../../apps/vale/vocab.json', import.meta.url),
  ))
  await write('/vocab', words)
  let components = Object.entries(words.$defs)
    .filter(([, value]) => (value as { component?: boolean }).component)
    .map(([key]) => key)
  await write(
    '/tools',
    parseTools(words, [
      ...components,
      'session',
      'call',
      'wake',
      'entry',
      'content',
      'using',
      'questions',
      'notice',
    ]),
  )
  let hero = 'c0000000-0000-4000-8000-000000000003'
  await write('/apply', {
    entities: [{
      entity: { eid: hero },
      player: {},
      seen: { level: 'mossvale', x: 1, z: 5, at: new Date().toISOString() },
    }],
  })

  let worker = workerOf(flat(5, [], [{
    kind: 'oak',
    x: 5,
    z: 5,
    seed: 1,
    natural: true,
  }]))
  let limits: unknown[] = []
  let asks = 0
  p.env.DISPATCH = {
    get(_script, _args, options) {
      limits.push(options.limits)
      return {
        fetch: async (req) => {
          assertEquals(
            await granted(req, p.env.SESSION_SECRET, name),
            { person: k.app.eid, role: 'editor' },
          )
          return worker.fetch(req, {
            APP: {
              fetch: (path: string, init?: RequestInit) => {
                if (path == 'ai/run') {
                  asks++
                  return Promise.resolve(Response.json({
                    answers: { tree: { choice: 'tree1' } },
                  }))
                }
                let content = path == 'apply'
                  ? {
                    ...init,
                    body: JSON.stringify(
                      JSON.parse(String(init?.body)).entities,
                    ),
                  }
                  : init
                return door(`/${path}`, content, {
                  'x-yak-person': k.app.eid,
                  'x-yak-role': 'editor',
                })
              },
            },
          })
        },
      }
    },
  } as Dispatch

  await runCommand(
    { env: p.env, dir: k.dir, person: ADA },
    'ada/cookbook',
    'gather_wood',
    { player: hero, count: 1 },
  )
  let [order] = await read(door, '.directive&?call&?wake&?companion')
  assert(order)
  let eid = order.entity.eid
  let store = p.object(name)
  time.tick(5_000)
  let first = await store.tick(Date.now())
  let [chosen] = await read(door, `.eid=${eid}&?companion`)
  assert(
    chosen.companion,
    JSON.stringify({
      order,
      chosen,
      first,
      calls: await read(door, `.call.source=${eid}&?execution&?error`),
      results: await read(door, '.result&?error&?content'),
      limits,
    }),
  )
  assertEquals(chosen.companion.phase, 'walk')
  assertEquals(asks, 1)

  // A removed schedule stays quiet after a new Store instance takes over.
  await write('/apply', {
    entities: [{
      entity: { eid },
      call: null,
      wake: null,
    }],
  })
  time.tick(5_000)
  store = new Store(p.states.get(name)!, p.env)
  let ns = p.env.STORE
  p.env.STORE = {
    idFromName: (n) => ns.idFromName(n),
    get: (id) =>
      String(id) == name ? { fetch: (req) => store.fetch(req) } : ns.get(id),
  }
  door = appStore(p.env.STORE, k.space, k.app)
  await store.tick(Date.now())
  let [paused] = await read(door, `.eid=${eid}&?companion`)
  assertEquals(paused.companion.call, chosen.companion.call)
  await write('/apply', {
    entities: [{
      entity: { eid },
      call: order.call,
      wake: { while: [{ match: '.directive', every: '5s' }] },
    }],
  })
  for (let i = 0; i < 8; i++) {
    time.tick(5_000)
    await store.tick(Date.now())
    let [current] = await read(door, `.eid=${eid}&?companion`)
    if (current.companion.status == 'Done') break
  }
  let [finished] = await read(door, `.eid=${eid}&?companion&?wake`)
  assertEquals(finished.companion.status, 'Done')
  assertEquals(finished.wake, undefined)
  let items = await read(door, `.item.owner=${hero}&?gathered`)
  assertEquals(items.length, 1)
  assertEquals(items[0].gathered.directive, eid)

  let calls = await read(door, `.call.source=${eid}&?created`)
  let old = calls[0]
  let res = await commandWorker(
    p.env,
    k.space,
    k.app,
    { person: k.app.eid, role: 'editor' },
    '/companion/tick',
    {},
    { call: old.entity.eid, at: old.created.at, source: eid },
  )
  assertEquals(res.status, 200)
  assertEquals((await read(door, `.item.owner=${hero}`)).length, 1)
  assert(
    limits.every((v) =>
      JSON.stringify(v) == JSON.stringify({ cpuMs: 5_000, subRequests: 50 })
    ),
  )
  let seen = await read(
    door,
    `.item.owner=${hero}&?gathered`,
    { 'x-yak-person': SECOND, 'x-yak-role': 'viewer' },
  )
  assertEquals(seen.length, 1)
  assertEquals(seen[0].gathered.directive, eid)
})
