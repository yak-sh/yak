// A socket stands on the directory's word, asked again on every frame: a seat
// or grant withdrawn there closes it, whatever rows the app's own store still
// holds about the person, with or without a serving copy in front.
import { equal, test, until } from '@yaks/testing'
import type { Frame } from '@yaks/api'
import { installPair, made } from '../../packages/workerd/testing.ts'
import * as apps from './apps.ts'
import { platform } from './testing.ts'
import {
  ADA,
  ADA_OWNS,
  as,
  SECRET,
  seeded,
  visit,
} from './serving-data-probe.ts'
import { servingCopy } from './serving-probe.ts'
import { grantEid } from '@yaks/platform/app-writes'
import { storeName } from './directory.ts'

let BOB = 'b0000000-0000-4000-8000-0000000000b0'
let CAROL = 'c0000000-0000-4000-8000-0000000000c0'
let STANDING = 'b0000000-0000-4000-8000-00000000000a'

type Standing = 'seat' | 'grant'

// Ada's private cookbook, Bob standing in it by a seat in her space or by a
// grant on the app alone, both written in the directory.
let scene = async (standing: Standing, copied: boolean) => {
  let rpc = servingCopy()
  let runtime = platform(
    SECRET,
    copied ? { SERVING_COPY: { idFromName: (n) => n, get: () => rpc } } : {},
  )
  let { env } = runtime
  let { dir, space, app } = await seeded(env, 'private')
  await dir.apply({
    entities: [
      { entity: { eid: BOB }, person: {} },
      { entity: { eid: CAROL }, person: {} },
      standing == 'seat'
        ? {
          entity: { eid: STANDING },
          member: { space: space.eid, person: BOB, role: 'editor' },
        }
        : {
          entity: { eid: STANDING },
          grant: { app: app.eid, person: BOB, access: 'editor' },
        },
    ],
  }, ADA_OWNS)
  let object = runtime.object(storeName(space, app))
  let write = async (cookie: string, ...bundles: object[]) => {
    let response = await apps.fetch(
      visit('/cookbook/api/apply', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(bundles),
      }),
      env,
    )
    await response.body?.cancel()
    return response.status
  }
  let titled = (title: string) => ({
    entity: { eid: crypto.randomUUID() },
    doc: { title },
  })
  // A socket of `cookie`'s on the app, or the status the upgrade was refused with.
  let watch = async (cookie: string) => {
    let undo = installPair()
    let ws
    try {
      let response = await apps.fetch(
        visit('/cookbook/api/ws', {
          headers: { cookie, upgrade: 'websocket' },
        }),
        env,
      )
      await response.body?.cancel()
      if (response.status != 101) return response.status
      ws = made.at(-1)![1]
    } finally {
      undo()
    }
    let closes: (number | undefined)[] = []
    ws.close = (code) => void closes.push(code)
    let titles = () =>
      (ws.taken() as Frame[]).flatMap((f) =>
        (f.bundles ?? []).map((b) => (b.doc as { title: string }).title)
      )
    let subscribe = async (id: string) => {
      await object.webSocketMessage(
        ws,
        JSON.stringify({ subscribe: '.doc', id }),
      )
      await until(() => ws.sent.length > 0 || closes.length > 0)
    }
    return { ws, closes, titles, subscribe }
  }
  let withdraw = () =>
    dir.apply(
      { entities: [{ entity: { eid: STANDING }, $delete: true }] },
      ADA_OWNS,
    )
  return { runtime, app, write, titled, watch, withdraw }
}

for (let copied of [false, true]) {
  let copy = copied ? 'with' : 'without'
  for (let standing of ['seat', 'grant'] as const) {
    test(`a private app ${copy} a serving copy closes open sockets when their ${standing} is withdrawn`, async () => {
      let { runtime, write, titled, watch, withdraw } = await scene(
        standing,
        copied,
      )
      await using _ = runtime
      let bob = await as(BOB), ada = await as(ADA)
      // Bob's write mirrors his grant into the app's store (`vouching`),
      // the row the store's own policy would otherwise still answer for.
      equal(await write(bob, titled('Lemon drizzle')), 200)
      let inbound = await watch(bob), outbound = await watch(bob)
      if (typeof inbound == 'number' || typeof outbound == 'number') {
        throw new Error(`refused ${inbound} ${outbound}`)
      }
      await inbound.subscribe('first')
      await outbound.subscribe('first')
      equal([inbound.titles(), outbound.titles()], [['Lemon drizzle'], [
        'Lemon drizzle',
      ]])
      await withdraw()

      await inbound.subscribe('later')
      equal([inbound.titles(), inbound.closes], [[], [1012]])
      equal(await write(ada, titled('Ginger cake')), 200)
      await runtime.settled()
      equal([outbound.titles(), outbound.closes], [[], [1012]])
    })
  }

  test(`a grant in the store ${copy} a serving copy opens no socket for someone the directory never admitted`, async () => {
    let { runtime, app, write, watch } = await scene('seat', copied)
    await using _ = runtime
    let bob = await as(BOB), ada = await as(ADA), carol = await as(CAROL)
    let grant = (eid: string) => ({
      entity: { eid },
      grant: { app: app.eid, person: CAROL, access: 'viewer' },
    })
    // An editor writes no grant, mirrored or not: it asks the owner's floor.
    equal(await write(bob, grant(crypto.randomUUID())), 403)
    equal(await write(bob, grant(grantEid(app.eid, CAROL))), 403)
    // The owner may, and it still opens nothing the directory did not.
    equal(await write(ada, grant(crypto.randomUUID())), 200)
    equal(await watch(carol), 403)
  })
}
