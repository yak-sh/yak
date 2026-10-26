// A page's socket through the app door (apps.ts `/ws`): one round trip to its
// store, which answers the socket, or says the words the app uses from other
// homes, so the door opens one across them (page-socket.ts) instead.
import { equal, test } from '@yaks/testing'
import { installPair } from '../../packages/workerd/testing.ts'
import * as apps from './apps.ts'
import { USES } from './door.ts'
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
test('a page socket of its own words opens in one round trip to its store', () =>
  equal(own, { status: 101, asked: ['/ws?uses=1'] }))

let store = await (async () => {
  await using scenario = platform()
  let { env } = scenario
  let { app } = await seeded(env)
  let object = env.STORE.get(env.STORE.idFromName(app.store!))
  let ask = (path: string, init: RequestInit = {}) =>
    object.fetch(
      new Request(`https://store${path}`, {
        ...init,
        headers: {
          'x-store': app.store!,
          'x-yak-app': app.eid,
          'x-yak-access': app.access,
          upgrade: 'websocket',
          ...KERNEL,
        },
      }),
    )
  await (await ask('/uses', {
    method: 'POST',
    body: JSON.stringify({ shelf: 'library' }),
  })).body?.cancel()
  let answer = await ask('/ws?uses=1')
  return { status: answer.status, uses: answer.headers.get(USES) }
})()
test('a store whose app uses words from other homes answers its socket with them', () =>
  equal(store, { status: 204, uses: JSON.stringify({ shelf: 'library' }) }))
