// What the directory's writes take out of the edge. A published app's writes
// and the listings (home and /gallery, site.ts, T-143236): a release leaves
// them kept and takes out only its card's picture, and a change to what they
// show of it takes them out. A delete takes out what its row could have been
// on, and a row no page shows takes nothing (T-148652).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { connector, fresh, meta, recording, signIn } from './probe.ts'

let { purged, PURGER } = recording()
let k = await fresh({}, (env) => void (env.PURGER = PURGER))
// The tags a piece of work purged.
let since = async (work: () => Promise<unknown>) => {
  await k.settled()
  purged.length = 0
  await work()
  await k.settled()
  return [...new Set(purged)].sort()
}

test("a published app's release purges its card and not the listings, and a new title purges them", async () => {
  let agent = connector(k, (await signIn(k)).cookie)
  let app = 'garden'
  // The tags a call purged, but its app's and its space's own pages.
  let purges = async (tool: string, args: Record<string, unknown> = {}) =>
    (await since(() => agent.tool(tool, { app, ...args })))
      .filter((tag) => !/^(app|space):/.test(tag))
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
})

test('signing in purges no page, and deleting a shown row still does', async () => {
  try {
    // Once in, as a newcomer whose space is made; again, as someone back.
    let { email } = await signIn(k)
    let signing = await since(() => signIn(k, email))
    let dir = meta(k)
    await dir.apply([{ entity: { eid: '$t' }, doc: { title: 'Shown' } }])
    let [row] = await dir.query('.doc.title=Shown')
    let deleting = await since(() =>
      dir.apply([{ entity: { eid: row.entity.eid }, tombstone: {} }])
    )
    assertEquals({ signing, deleting: deleting.includes('site') }, {
      signing: [],
      deleting: true,
    })
  } finally {
    await k.stop()
  }
})
