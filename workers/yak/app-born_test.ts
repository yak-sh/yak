// What app_new leaves for later (T-143070): it waits on no purge of the edge,
// since an app answers nothing before its first release, and that release
// purges its space; and its store is made behind the answer, so the first
// write or deploy finds it standing. Its object starts while the directory
// writes the row (T-143307), and starting it keeps nothing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { connector, fresh, recording, signIn } from './probe.ts'
import { Store } from './graph.ts'
import { WARM } from './door.ts'
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
