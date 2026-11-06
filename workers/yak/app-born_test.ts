// What app_new leaves for later (T-143070): it waits on no purge of the edge,
// since an app answers nothing before its first release, and that release
// purges its space; and its store is made behind the answer, so the first
// write or deploy finds it standing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { connector, fresh, recording, signIn } from './probe.ts'

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
          fetch: (req: Request) => {
            reached.push(req.headers.get('x-store') ?? '')
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
    assertEquals(reached.some((name) => name.includes('/garden.')), true)

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
