// Public files (public-files.ts, D-132641): a private app's member publishes
// a file at a path of its address, and a stranger is served it there before
// the app's private gate; unpublished, the address is the app's again.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { test } from '@yaks/testing'
import * as apps from './apps.ts'
import type { Env } from './env.ts'
import { pageAt } from './page-cache.ts'
import { appTag, type Purgers } from './purge.ts'
import { fetch as siteFetch } from './site.ts'
import { ADA, as, platform, seeded, visit } from './serving-probe.ts'

let PAGE =
  '<!doctype html><head><title>Week 1</title></head><body>Psalm 23</body>'

// Ada's private cookbook, and what she published to it as the file loads.
// Site's cache is purged through a Purger that writes down each tag.
let purged: string[] = []
let PURGER: Purgers = {
  idFromName: () => 'purger',
  get: () => ({ purge: (tags) => Promise.resolve(void purged.push(...tags)) }),
}
let { env, files } = platform({ PURGER } as Partial<Env>)
let { app } = await seeded(env, 'private')
let ada = await as(ADA)

// One request at the cookbook, as Ada (`cookie`) or as nobody.
let ask = (path: string, init: RequestInit = {}, cookie?: string) =>
  apps.fetch(
    visit(`/cookbook/${path}`, {
      ...init,
      headers: { ...init.headers as object, ...cookie ? { cookie } : {} },
    }),
    env,
  )
let publish = async (path: string | null, body = PAGE) =>
  await (await ask(`api/public${path == null ? '' : `/${path}`}`, {
    method: path == null ? 'POST' : 'PUT',
    body,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  }, ada)).json()

// The store hops a page view of Ada's takes (Server-Timing's `hops`), at a
// path the app answers itself: before it published anything, and after. The
// first view after a write reads the space afresh, so each is the second.
let hops = async (path: string) => {
  let res = await ask(path, {}, ada)
  await res.body?.cancel()
  return res.headers.get('server-timing')?.match(/(?:^|, )hops;dur=(\d+)/)?.[1]
}
await hops('recipes/soup')
let unpublishedHops = await hops('recipes/soup')

let week = await publish('notes/week-1')
let fresh = await publish(null)
await publish('posts/hello/index.html')
await Promise.all([publish('together/a', 'A'), publish('together/b', 'B')])
let together = await Promise.all(
  ['together/a', 'together/b'].map(async (p) => await (await ask(p)).text()),
)
await hops('recipes/soup')
let publishedHops = await hops('recipes/soup')
await publish('gone')
purged.length = 0
let ungone = await ask('api/public/gone', { method: 'DELETE' }, ada)
let ungonePurged = [...purged]
// Two paths share bytes `one`, and `a` then moves on to `two`.
let kept = () =>
  new Set([...files.held.keys()].filter((k) => k.includes('/public/'))).size
let unique = kept()
await publish('a', 'one')
await publish('b', 'one')
await publish('a', 'two')
let shared = kept() - unique

test("a stranger is served a private app's published page, woven", async () => {
  let page = await ask('notes/week-1')
  assertEquals(page.headers.get('content-type'), 'text/html; charset=utf-8')
  let text = await page.text()
  assert(text.includes('Psalm 23'), text)
  assert(text.includes('data-yak-at="/cookbook/"'), text)
})

test("Site keeps a private app's published page, tagged with its app", async () => {
  let kept = await siteFetch(
    new Request(pageAt('ada.yaks.app', '/cookbook/notes/week-1', null)),
    env,
  )
  assertEquals(kept.status, 200)
  assert(
    kept.headers.get('cache-tag')?.startsWith('app:'),
    kept.headers.get('cache-tag') ?? '',
  )
  assert((await kept.text()).includes('Psalm 23'))
})

test('a published file answers at the url its door gave', () => {
  assertEquals(week.url, 'https://ada.yaks.app/cookbook/notes/week-1')
  assertEquals(week.mime, 'text/html; charset=utf-8')
})

test("the rest of a private app stays its members'", async () => {
  assertEquals((await ask('')).status, 303)
})

test('with no path, a file is published at a new UUID path', async () => {
  assertMatch(
    fresh.path,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  )
  assertEquals((await ask(fresh.path)).status, 200)
})

test('a folder asked with its slash is its index.html', async () => {
  assertEquals((await ask('posts/hello/')).status, 200)
})

test('unpublishing gives the address back to the app', async () => {
  assertEquals(ungone.status, 200)
  assertEquals((await ask('gone')).status, 303)
})

test("unpublishing purges the app's kept pages", () => {
  assert(ungonePurged.includes(appTag(app.eid)), String(ungonePurged))
})

test('files published at once are each served', () => {
  assertEquals(together.map((text) => text[0]), ['A', 'B'])
})

test('a page view where nothing is published asks the directory nothing more', () => {
  assert(unpublishedHops, 'the page view counted its hops')
  assertEquals(publishedHops, unpublishedHops)
})

test('replacing a file lets go of bytes no published file names', async () => {
  assertEquals(shared, 2)
  await publish('b', 'two')
  assertEquals(kept() - unique, 1)
})

test("publishing is the app's writers' alone", async () => {
  let stranger = await ask('api/public/x', { method: 'PUT', body: PAGE })
  assertEquals(stranger.status, 401)
})

test('a path the door may not publish at is refused', async () => {
  let no = await ask('api/public/api/x', { method: 'PUT', body: PAGE }, ada)
  assertEquals(no.status, 400)
})
