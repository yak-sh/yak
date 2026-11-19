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
import { storeName } from './directory.ts'

let BOB = 'b0000000-0000-4000-8000-0000000000b0'
let SEAT = 'b0000000-0000-4000-8000-00000000000a'

test('a private app without a serving copy closes open sockets when their member is removed', async () => {
  await using runtime = platform(SECRET)
  let { env } = runtime
  let { dir, space, app } = await seeded(env, 'private')
  await dir.apply({
    entities: [
      { entity: { eid: BOB }, person: {} },
      {
        entity: { eid: SEAT },
        member: { space: space.eid, person: BOB, role: 'editor' },
      },
    ],
  }, ADA_OWNS)
  let bob = await as(BOB), ada = await as(ADA)
  let write = async (title: string, cookie: string) => {
    let response = await apps.fetch(
      visit('/cookbook/api/apply', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify([{
          entity: { eid: crypto.randomUUID() },
          doc: { title },
        }]),
      }),
      env,
    )
    await response.body?.cancel()
    equal(response.status, 200)
  }
  let object = runtime.object(storeName(space, app))
  let watch = async () => {
    let undo = installPair()
    let ws
    try {
      let response = await apps.fetch(
        visit('/cookbook/api/ws', {
          headers: { cookie: bob, upgrade: 'websocket' },
        }),
        env,
      )
      await response.body?.cancel()
      equal(response.status, 101)
      ws = made.at(-1)![1]
    } finally {
      undo()
    }
    let closes: (number | undefined)[] = []
    ws.close = (code) => void closes.push(code)
    let subscribe = (id: string) =>
      object.webSocketMessage(ws, JSON.stringify({ subscribe: '.doc', id }))
    await subscribe('first')
    await until(() => ws.sent.length > 0 || closes.length > 0)
    equal(
      (ws.taken() as Frame[]).flatMap((f) =>
        (f.bundles ?? []).map((b) => (b.doc as { title: string }).title)
      ),
      ['Lemon drizzle'],
    )
    return { ws, closes, subscribe }
  }

  await write('Lemon drizzle', bob)
  let inbound = await watch(), outbound = await watch()
  await dir.apply(
    { entities: [{ entity: { eid: SEAT }, $delete: true }] },
    ADA_OWNS,
  )
  await inbound.subscribe('later')
  equal([inbound.ws.taken(), inbound.closes], [[], [1012]])

  await write('Ginger cake', ada)
  await runtime.settled()
  equal([outbound.ws.taken(), outbound.closes], [[], [1012]])
})
