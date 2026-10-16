// An app's public pages kept at the Site entrypoint (page-cache.ts): the
// gateway's half (`asked`) over a Site with a cache that behaves as
// Cloudflare's does (kept by URL while public, tagged, purged by tag), the
// tags a page carries, and the writes that owe them a purge
// (facets/pages-graph.ts `owed`). The address Site serves from is apps.ts
// `edged`; the booted kernel is not needed to decide what is kept.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import type { Env } from './env.ts'
import { owed } from './facets/pages-graph.ts'
import {
  asked,
  keep,
  keepable,
  kept,
  passed,
  unkept,
  visitor,
} from './page-cache.ts'
import { clock } from './timing.ts'
import { dataset } from './testing.ts'

let space = { eid: 's', slug: 'ada' }
let app = { eid: 'a', slug: 'cookbook' }

let page = (text: string, status = 200) =>
  new Response(`<body>${text}</body>`, {
    status,
    headers: {
      'content-type': 'text/html',
      'cache-control': 'public, no-cache',
      etag: `"${text}"`,
    },
  })

// Site with its cache in front: what Site makes of an address it is asked
// (`origin`, given the visitor it serves it to) is kept by URL while public.
let edge = (origin: (visitor: Request) => Response) => {
  let held = new Map<string, Response>()
  let asks = 0
  return {
    held,
    asks: () => asks,
    fetch: async (req: Request) => {
      asks++
      let hit = held.get(req.url)
      if (hit) return hit.clone()
      let got = await kept(origin(visitor(req.url)!))
      if (got.headers.get('cache-control')?.startsWith('public')) {
        held.set(req.url, got.clone())
      }
      return got
    },
  }
}

// The gateway over such a Site, and the views it counted.
let gateway = (origin: (visitor: Request) => Response, counting = false) => {
  let site = edge(origin)
  let views = dataset()
  let env = {
    SITE: site,
    ...counting ? { VIEWS: views } : {},
  } as unknown as Env
  return {
    site,
    views,
    env,
    get: (url = 'https://ada.yaks.app/cookbook/', init: RequestInit = {}) =>
      asked(new Request(url, init), env, clock()),
  }
}

test('an open app is kept as a public one is', () => {
  for (let access of ['public', 'open'] as const) {
    assert(keepable({ access, worker: '' }), access)
  }
  assert(!keepable({ access: 'private', worker: '' }))
})

test("a sandboxed page and a worker's page are never kept", () => {
  let sandboxed = {
    installed: { of: null, version: 1, sandboxed: new Date().toISOString() },
  }
  assert(!keepable({ access: 'public', worker: '', ...sandboxed }))
  assert(!keepable({ access: 'public', worker: 'app-script' }))
})

// Prime the cache as setup, retaining the first answer for the timed comparison.
let cachedText = 'one'
let cachedOrigins = 0
let cachedGateway = gateway(
  () => (cachedOrigins++, keep(page(cachedText), space, app)),
)
let firstCachedPage = (await cachedGateway.get())!
let firstCachedText = await firstCachedPage.text()
cachedText = 'two'

test('a public page is answered from the edge after its first view', async () => {
  let again = (await cachedGateway.get())!
  assertEquals(await again.text(), firstCachedText)
  assertEquals(cachedOrigins, 1)
  assertEquals(again.headers.get('cache-control'), 'public, no-cache')
  for (let name of ['cache-tag', 'x-yak-seen', 'x-yak-browser-cache', 'age']) {
    assertEquals(again.headers.get(name), null, name)
  }
})

test('a kept page answers a revalidation with a 304, and counts a HEAD as a view', async () => {
  let g = gateway(() => keep(page('one'), space, app), true)
  let head = (await g.get(undefined, { method: 'HEAD' }))!
  assertEquals([head.status, await head.text()], [200, ''])
  let fresh = await g.get(undefined, {
    headers: { 'if-none-match': head.headers.get('etag')! },
  })
  assertEquals(fresh!.status, 304)
  // The HEAD is a view; the 304 sent none.
  assertEquals(g.views.points.length, 1)
})

// A write, and the rows it leaves (the app `a` of space `s`, and the space).
let owes = (b: Bundle) =>
  owed([b], () =>
    Promise.resolve([
      { entity: { eid: 'a' }, app: { slug: 'cookbook', space: 's' } },
      { entity: { eid: 's' }, space: { slug: 'ada' } },
    ].filter((row) => row.entity.eid == b.entity.eid)))

test('a deploy, a setting and a plan change are each seen at once', async () => {
  assertEquals(await owes({ entity: { eid: 'a' }, app: { version: 2 } }), [
    'app:a',
  ])
  assertEquals(
    await owes({ entity: { eid: 'a' }, theme: { color: '#1b3a2f' } }),
    ['app:a'],
  )
  assertEquals(await owes({ entity: { eid: 's' }, plan: { tier: 'plus' } }), [
    'space:s',
  ])
})

test('a page made private leaves the edge, and is no longer asked of Site', async () => {
  assertEquals(
    await owes({ entity: { eid: 'a' }, app: { access: 'private' } }),
    [
      'app:a',
    ],
  )
  let g = gateway(() => keep(page('one'), space, app))
  assertEquals((await g.get())!.status, 200)
  unkept(new Request('https://ada.yaks.app/cookbook/'), g.env, '/cookbook/')
  assertEquals(await g.get(), null)
  assertEquals(g.site.asks(), 1)
})

test('an address Site passed is not asked of it again', async () => {
  let g = gateway(() => passed())
  assertEquals(await g.get(), null)
  assertEquals(await g.get('https://ada.yaks.app/cookbook/another.html'), null)
  assertEquals(await g.get(), null)
  // The first address was asked; its repeat was remembered as a pass.
  assertEquals(g.site.asks(), 2)
})

test('a missing page is kept until a deploy writes it', async () => {
  let missing = keep(page('lost', 404), space, app)
  assertEquals(missing.status, 404)
  let held = await kept(missing)
  assertEquals(held.status, 404)
  // It carries the tag the deploy purges.
  assertStringIncludes(held.headers.get('cache-tag')!, 'app:a')
  assertEquals(await owes({ entity: { eid: 'a' }, app: { version: 2 } }), [
    'app:a',
  ])
})

test("a space's 404 is kept until an app takes the address", async () => {
  let held = await kept(keep(page('none', 404), space, null))
  assertEquals(held.headers.get('cache-tag'), 'space:s')
  assertEquals(
    await owes({ entity: { eid: 'a' }, app: { slug: 'garden', space: 's' } }),
    ['space:s'],
  )
})

test('two spaces at one path keep two pages', async () => {
  let g = gateway((who) => keep(page(new URL(who.url).hostname), space, app))
  let ada = (await g.get('https://ada.yaks.app/cookbook/'))!
  let bob = (await g.get('https://bob.yaks.app/cookbook/'))!
  assertStringIncludes(await ada.text(), 'ada.yaks.app')
  assertStringIncludes(await bob.text(), 'bob.yaks.app')
  assertEquals(g.site.held.size, 2)
})

test('an answer that sets a cookie is never kept', async () => {
  let cookie = new Response('hi', { headers: { 'set-cookie': 'a=b' } })
  let ok = new Response('hi')
  assertEquals((await kept(keep(cookie, space, app))).status, 204)
  assertEquals((await kept(keep(ok, space, app))).status, 200)
})

test('a page of an app mid-release is not kept, and nor is its pass', async () => {
  let fence: string | null = '1:x'
  let g = gateway(() => keep(page('one'), space, { ...app, fence }))
  assertEquals(await g.get(), null)
  assertEquals(await g.get(), null)
  // Asked both times, so the release's own page is kept as soon as it commits.
  assertEquals([g.site.asks(), g.site.held.size], [2, 0])
  fence = null
  assertEquals(await (await g.get())!.text(), '<body>one</body>')
  assertEquals(g.site.held.size, 1)
})

// Site's render clock is useful only when this view actually ran it.
for (let status of ['MISS', 'EXPIRED', 'BYPASS', 'HIT', 'UPDATING', 'STALE']) {
  test(`a page ${status} reports only its own inner work`, async () => {
    let c = clock()
    let env = {
      SITE: {
        fetch: async () => {
          let r = await kept(keep(page('one'), space, app))
          r.headers.set('cf-cache-status', status)
          r.headers.set('server-timing', 'site_space;dur=19, site_total;dur=31')
          return r
        },
      },
    } as unknown as Env
    await asked(new Request('https://ada.yaks.app/cookbook/'), env, c)
    assertEquals(
      c.header().includes('site_space;dur=19'),
      ['MISS', 'EXPIRED', 'BYPASS'].includes(status),
    )
  })
}
