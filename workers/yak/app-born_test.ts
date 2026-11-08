// What app_new leaves for later (T-143070): it waits on no purge of the edge,
// since an app answers nothing before its first release, and that release
// purges its space; and its store is made behind the answer, so the first
// write or deploy finds it standing. Its object starts while the directory
// writes the row (T-143307), and starting it keeps nothing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { connector, fresh, recording, signIn } from './probe.ts'
import { Store } from './graph.ts'
import { WAKE, WARM } from './door.ts'
import { KERNEL } from './meta.ts'
import { state } from './testing.ts'

test('a new app purges nothing, stands its store up, and its first release purges its space', async () => {
  let { purged, PURGER } = recording()
  let reached: string[] = []
  let k = await fresh({}, (env) => {
    env.PURGER = PURGER
    let stores = env.STORE
    env.STORE = {
      ...stores,
      get: (id, options) => {
        let store = stores.get(id, options)
        return {
          ...store,
          fetch: async (req: Request) => {
            let name = req.headers.get('x-store') ?? ''
            let path = new URL(req.url).pathname
            // The directory's write of a born row, which alone names a handle.
            let birth = path == '/apply' &&
              (await req.clone().text()).includes('/garden.')
            reached.push(birth ? 'birth' : `${name} ${path}`)
            return store.fetch(req)
          },
        } as typeof store
      },
    }
  })
  try {
    let agent = connector(k, (await signIn(k)).cookie)
    await k.settled()
    purged.length = 0
    reached.length = 0
    let made = await agent.tool('app_new', { slug: 'garden', title: 'Garden' })
    await k.settled()
    let space = (await k.dir.space(/^app ([^/]+)\//.exec(made)![1]))!
    assertEquals(purged, [])
    let garden = reached.filter((r) => r.includes('/garden.'))
    assertEquals(garden[0].endsWith(` ${WARM}`), true)
    assertEquals(garden.some((r) => r.endsWith(' /graph')), true)
    assertEquals(reached.indexOf(garden[0]) < reached.indexOf('birth'), true)

    let deploy = async () => {
      purged.length = 0
      await agent.tool('app_files', {
        app: 'garden',
        op: 'write',
        path: 'index.html',
        content: `<h1>${crypto.randomUUID()}</h1>`,
      })
      await agent.tool('app_deploy', { app: 'garden' })
      await k.settled()
      return purged.filter((tag) => !tag.startsWith('app:')).sort()
    }
    assertEquals(await deploy(), [`space:${space.eid}`])
    assertEquals(await deploy(), [])
  } finally {
    await k.stop()
  }
})

test('a warmed store reads and writes nothing it holds', async () => {
  let ctx = state('warm/new.abcdef', false)
  let touched: string[] = []
  let storage = ctx.storage
  let store = new Store({
    ...ctx,
    storage: new Proxy(storage, {
      get: (on, key) => (touched.push(String(key)), Reflect.get(on, key)),
    }),
  })
  touched.length = 0
  let r = await store.fetch(
    new Request(`http://store${WARM}`, {
      headers: { ...KERNEL, 'x-store': 'warm/new.abcdef' },
    }),
  )
  assertEquals([r.status, touched], [204, []])
})

// A page's wake (used.ts `wake`) boots the store its scripts ask next, so
// their first call finds it up and waits on no start (`x-yak-wake`), and one
// in the trash wakes to nothing.
test('a woken store is up for the request behind it, unless it is in the trash', async () => {
  let name = 'ada/cookbook.abcdef'
  let asks = async (woken: boolean, trashed = false) => {
    let ctx = state(name)
    if (trashed) await ctx.storage.put('dormant', true)
    let store = new Store(ctx)
    let send = (path: string) =>
      store.fetch(
        new Request(`http://store${path}`, {
          headers: { ...KERNEL, 'x-store': name },
        }),
      )
    let wake = woken ? (await send(WAKE)).status : null
    let read = await send('/query?q=.doc')
    return [wake, read.status, read.headers.has('x-yak-wake')]
  }
  assertEquals(await asks(false), [null, 200, true])
  assertEquals(await asks(true), [204, 200, false])
  assertEquals(await asks(true, true), [404, 404, false])
})

test('a read that reaches a store as its wake does joins the one boot', async () => {
  let name = 'ada/cookbook.abcdef', ctx = state(name), boots = 0
  // What a boot reads first, once (graph.ts `#start`).
  let get = ctx.storage.get.bind(ctx.storage)
  ctx.storage.get = ((key: string) => {
    if (key == 'expires') boots++
    return get(key)
  }) as typeof get
  let store = new Store(ctx)
  let send = (path: string) =>
    store.fetch(
      new Request(`http://store${path}`, {
        headers: { ...KERNEL, 'x-store': name },
      }),
    ).then((r) => r.status)
  assertEquals(await Promise.all([send(WAKE), send('/query?q=.doc')]), [
    204,
    200,
  ])
  assertEquals(boots, 1)
})
