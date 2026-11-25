// A page's socket through the app door (apps.ts `/ws`): one round trip to its
// store, which answers the socket whatever words its app borrows (graph.ts
// `#lending`).
import { equal, test } from '@yaks/testing'
import { assert } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { installPair, made } from '../../packages/workerd/testing.ts'
import * as apps from './apps.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { KERNEL } from './meta.ts'
import { ADA, as, platform, seeded, visit } from './serving-probe.ts'

// Ada opens her cookbook's socket, with `uses` held by its store; what comes
// back, and what the door asked the store on the way.
let opened = async (uses?: Record<string, string>) => {
  await using scenario = platform()
  let { env } = scenario
  let { app } = await seeded(env)
  let store = env.STORE.get(env.STORE.idFromName(app.store!))
  if (uses) {
    let put = await store.fetch(
      new Request('https://store/uses', {
        method: 'POST',
        headers: { 'x-store': app.store!, ...KERNEL },
        body: JSON.stringify(uses),
      }),
    )
    await put.body?.cancel()
  }
  let asked: string[] = []
  let stores = env.STORE
  env.STORE = {
    idFromName: (name) => stores.idFromName(name),
    get: (id) => ({
      fetch: (req: Request) => {
        let { pathname, search } = new URL(req.url)
        if (['/ws', '/uses'].includes(pathname)) asked.push(pathname + search)
        return stores.get(id).fetch(req)
      },
    }),
  }
  let undo = installPair()
  try {
    let res = await apps.fetch(
      visit('/cookbook/api/ws', {
        headers: { cookie: await as(ADA), upgrade: 'websocket' },
      }),
      env,
    )
    await res.body?.cancel()
    return { status: res.status, asked }
  } finally {
    undo()
  }
}

let own = await opened()
let borrowing = await opened({ shelf: 'library' })
test('a page socket opens in one round trip to its store, whatever it borrows', () =>
  equal([own, borrowing], [
    { status: 101, asked: ['/ws'] },
    { status: 101, asked: ['/ws'] },
  ]))

// A watch the app's store cannot read is the page's code wrong: the store
// files it as the app's break, once however often the page asks it again, and
// the page still hears the refusal (graph.ts `#mistook`).
let mistook = await (async () => {
  let filed: Bundle[] = []
  await using scenario = platform({
    ERRORS: { send: (rows) => Promise.resolve(void filed.push(...rows)) },
  })
  let { env, object, settled } = scenario
  let { app } = await seeded(env)
  let undo = installPair()
  try {
    let res = await apps.fetch(
      visit('/cookbook/api/ws', {
        headers: { cookie: await as(ADA), upgrade: 'websocket' },
      }),
      env,
    )
    await res.body?.cancel()
    let ws = made.at(-1)![1]
    for (let id of ['a', 'b']) {
      await object(app.store!).webSocketMessage(
        ws,
        JSON.stringify({ subscribe: '.nope', id }),
      )
    }
    await settled()
    let broke = filed.filter((row) => row.exception)
    return {
      refused: ws.taken().map((f) => [f.id, f.refused?.message]),
      breaks: broke.map((row) => [
        (row.exception as { value: string }).value,
        (row.error as { tags: { request: string } }).tags.request,
        (row.during as { app: string }).app == app.eid,
      ]),
    }
  } finally {
    undo()
  }
})()
test("a page's watch its store refuses in its own words is filed once as the app's break", () => {
  let said = String(mistook.refused[0]?.[1])
  assert(said.startsWith('unknown prop: .nope'), said)
  equal(mistook, {
    refused: [['a', said], ['b', said]],
    breaks: [[said, 'subscribe .nope', true]],
  })
})

// The directory holds no app, so no caller has standing on its own `/ws`, and
// every frame on one is refused: its person's reads are `/person/ws`. A
// socket opened there is refused at its handshake, not admitted and then
// refused on its first frame (#011e217c15).
let directory = await (async () => {
  await using scenario = platform()
  let { env } = scenario
  await seeded(env)
  let undo = installPair()
  try {
    let res = await env.STORE.get(env.STORE.idFromName(PLATFORM_STORE)).fetch(
      new Request('https://store/ws', {
        headers: {
          ...KERNEL,
          'x-store': PLATFORM_STORE,
          'x-yak-person': ADA,
          upgrade: 'websocket',
        },
      }),
    )
    return [res.status, (await res.json()).error]
  } finally {
    undo()
  }
})()
test('the directory refuses a socket on its own /ws at the handshake', () =>
  equal(directory, [404, 'NotFound']))
