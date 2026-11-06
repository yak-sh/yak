// What a published app's writes take out of the listings (home and /gallery,
// site.ts) at the edge (T-143236): a release leaves them kept and takes out
// only its card's picture, and a change to what they show of it takes them
// out.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { connector, fresh, recording, signIn } from './probe.ts'

test("a published app's release purges its card and not the listings, and a new title purges them", async () => {
  let { purged, PURGER } = recording()
  let k = await fresh({}, (env) => void (env.PURGER = PURGER))
  try {
    let agent = connector(k, (await signIn(k)).cookie)
    let app = 'garden'
    // The tags a call purged, but its app's own pages.
    let purges = async (tool: string, args: Record<string, unknown> = {}) => {
      await k.settled()
      purged.length = 0
      await agent.tool(tool, { app, ...args })
      await k.settled()
      return [...new Set(purged.filter((tag) => !tag.startsWith('app:')))]
        .sort()
    }
    let release = async () => {
      await agent.tool('app_files', {
        app,
        op: 'write',
        path: 'index.html',
        content: `<h1>${crypto.randomUUID()}</h1>`,
      })
      return await purges('app_deploy')
    }
    await agent.tool('app_new', { slug: app, title: 'Garden' })
    await release()
    assertEquals(await purges('app_publish', { about: 'a garden' }), ['site'])
    let eid = (await k.dir.offers()).find((o) => o.app.slug == app)!.app.eid
    assertEquals(await release(), [`card:${eid}`])
    assertEquals(await purges('app_set', { title: 'Garden two' }), ['site'])
  } finally {
    await k.stop()
  }
})
