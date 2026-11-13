// A release through the connector's door runs in the object it may outlast
// its caller in (outlast.ts), as the caller, and answers what it released.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { connector, fresh, seed, unique } from './probe.ts'
import { Outlast } from './outlast-object.ts'
import type { Outlasts } from './outlast.ts'
import { durable } from '../../packages/durable-object/testing.ts'

test('app_deploy through the door runs in its object and answers its release', async () => {
  let keys: string[] = []
  let k = await fresh({}, (env) => {
    let objects = new Map<string, Outlast>()
    let storage = durable()
    let ctx = { storage, acceptWebSocket() {}, getWebSockets: () => [] }
    env.OUTLAST = {
      idFromName: (name) => (keys.push(name), name),
      get: (id) => {
        let name = id as string
        if (!objects.has(name)) objects.set(name, new Outlast(ctx, env))
        return objects.get(name)!
      },
    } satisfies Outlasts
  })
  try {
    let space = unique('outlast')
    let { cookie } = await seed(k, [{ slug: space, apps: ['site'] }])
    let agent = connector(k, cookie)
    await agent.tool('app_files', {
      space,
      app: 'site',
      files: [{ path: 'index.html', content: '<h1>Site</h1>' }],
    })
    let said = await agent.tool('app_deploy', { space, app: 'site' })
    assertStringIncludes(JSON.stringify(said), `deployed ${space}/site v1`)
    assertEquals(keys.length, 1)
    assertStringIncludes(keys[0], `|app_deploy|${space}/site`)
  } finally {
    await k.stop()
  }
})
