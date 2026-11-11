// A custom domain's own address at Site (site.ts `atDomain`): yak-front asks
// it by the hostname the browser asked, and Site reads whose it is, serves it
// as the gateway carries it, and keeps only what the gateway would answer any
// visitor, tagged with the domain so attaching, detaching or moving it takes
// it out before the write answers (facets/pages-graph.ts).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Env } from './env.ts'
import { pageAt } from './page-cache.ts'
import { recording } from './probe.ts'
import { fetch as siteFetch } from './site.ts'
import { ADA_OWNS, platform, seeded } from './serving-probe.ts'

let { purged, PURGER } = recording()
let { env } = platform({ PURGER } as Partial<Env>)
let { dir, space, app } = await seeded(env, 'public')
let diary = 'd0000000-0000-4000-8000-0000000000d1'
let hosts: Record<string, string> = {}
let attach = async (name: string, hostname: Record<string, unknown>) => {
  let eid = hosts[name] = crypto.randomUUID()
  await dir.apply({
    entities: [{
      entity: { eid },
      hostname: { name, serves: app.eid, stage: 'active', ...hostname },
    }],
  }, ADA_OWNS)
  return eid
}
await dir.apply({
  entities: [{
    entity: { eid: diary },
    app: {
      slug: 'diary',
      space: space.eid,
      version: 1,
      access: 'private',
      store: 'ada/diary.bbb222',
    },
  }],
}, ADA_OWNS)
// Neither app has a worker of its own, whose pages are never kept.
await dir.stamp({
  entities: [app.eid, diary].map((eid) => ({
    entity: { eid },
    app: { worker: '', source: 'one' },
  })),
}, ADA_OWNS)
await attach('her.com', {})
await attach('www.her.com', { to: 'her.com' })
await attach('pending.com', { stage: 'pending' })
await attach('unshown.com', { verification: { type: 'txt' } })
await attach('diary.com', { serves: diary })

// What Site answers at one address of a domain: its status and its tags.
let site = async (host: string, path = '/') => {
  let got = await siteFetch(new Request(pageAt(host, path, null)), env)
  await got.body?.cancel()
  return [got.status, got.headers.get('cache-tag')]
}

let keeps = await site('her.com', '/nope.html')
let passes = await Promise.all([
  site('www.her.com'),
  site('pending.com'),
  site('unshown.com'),
  site('diary.com'),
  site('nobody.com'),
  site('her.com', '/__yak/signin'),
])

test("Site keeps a domain's page tagged with its app, its space and the domain", () => {
  assertEquals(keeps, [
    404,
    `app:${app.eid},space:${space.eid},host:${hosts['her.com']}`,
  ])
})

test("Site keeps nothing the gateway wouldn't answer any visitor at a domain", () => {
  // One that sends its visitors on, isn't ready, opens a private app, is
  // nobody's, or is its sign-in handoff.
  assertEquals(passes, Array(6).fill([204, null]))
})

let detached = await (async () => {
  purged.length = 0
  await dir.apply({
    entities: [{ entity: { eid: hosts['her.com'] }, tombstone: {} }],
  }, ADA_OWNS)
  return [...purged]
})()

test('detaching a domain takes its pages out before the write answers', () => {
  assertEquals(detached.includes(`host:${hosts['her.com']}`), true)
})
