// An app's public pages kept at the Site entrypoint (page-cache.ts), through
// the gateway's own door, with Site behind a cache that behaves as Cloudflare's
// does: kept by URL while public, tagged, and purged by tag.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import * as apps from './apps.ts'
import { stamp } from './directory.ts'
import type { Env } from './env.ts'
import { keep, kept } from './page-cache.ts'
import * as sitePart from './site.ts'
import { dataset } from './testing.ts'
import { call, type Ctx } from './tools.ts'
import { ADA, as, platform, seeded, visit } from './serving-probe.ts'

type Held = {
  status: number
  headers: Headers
  body: ArrayBuffer
  tags: string[]
}

// A service binding as the runtime lends one: every property is a method of
// the far side, its own properties too, so a method is called as one.
type Far = Record<string, (...args: never[]) => unknown>
let remote = (far: Far, name: string): unknown =>
  new Proxy((...args: never[]) => {
    if (!Object.hasOwn(far, name)) {
      throw new TypeError(
        `The RPC receiver does not implement the method "${name}".`,
      )
    }
    return far[name](...args)
  }, { get: (_, prop) => remote(far, `${name}.${String(prop)}`) })
let binding = <T extends Far>(far: T): T =>
  new Proxy(far, {
    get: (_, name) => name == 'then' ? undefined : remote(far, String(name)),
  })

// Site with its cache in front, what that cache holds, and how often Site
// was asked.
let edge = () => {
  let held = new Map<string, Held>()
  let env!: Env
  let asks = 0
  let sent = (e: Held, status: string) => {
    let headers = new Headers(e.headers)
    headers.set('cf-cache-status', status)
    let empty = [204, 304].includes(e.status)
    return new Response(empty ? null : e.body.slice(0), {
      status: e.status,
      headers,
    })
  }
  let site = binding({
    fetch: async (req: Request) => {
      asks++
      let hit = held.get(req.url)
      if (hit) return sent(hit, 'HIT')
      let got = await sitePart.fetch(req, env)
      let e = {
        status: got.status,
        headers: got.headers,
        body: await got.arrayBuffer(),
        tags: (got.headers.get('cache-tag') ?? '').split(',').filter(Boolean),
      }
      if (!got.headers.get('cache-control')?.startsWith('public')) {
        return sent(e, 'BYPASS')
      }
      held.set(req.url, e)
      return sent(e, 'MISS')
    },
    purge: (tags: string[]) => {
      for (let [url, e] of held) {
        if (e.tags.some((t) => tags.includes(t))) held.delete(url)
      }
      return Promise.resolve({ success: true, errors: [] })
    },
  })
  return {
    site,
    bind: (e: Env) => env = e,
    pages: () => [...held.values()].filter((e) => e.status == 200).length,
    asks: () => asks,
  }
}

let page = (bytes: string) =>
  `<!doctype html><head></head><body>${bytes}</body>`

// Ada's public cookbook, served from its files and built with no worker, the
// way a release that ships none records it.
let cookbook = async (vars: Partial<Env> = {}) => {
  let cache = edge()
  let scenario = platform({ ...vars, SITE: cache.site })
  let { env, files } = scenario
  cache.bind(env)
  let { dir, space, app } = await seeded(env)
  await stamp(env, {
    entities: [{ entity: { eid: app.eid }, app: { worker: '' } }],
  })
  let put = (bytes: string) =>
    files.held.set(
      'ada/cookbook/index.html',
      new TextEncoder().encode(page(bytes)),
    )
  put('one')
  let ctx = { env, dir, person: ADA } as unknown as Ctx
  let tool = (name: string, args: Record<string, unknown> = {}) =>
    call(ctx, name, { space: 'ada', app: 'cookbook', ...args })
  let open = async (path = '/cookbook/', init: RequestInit = {}) => {
    let res = await apps.fetch(visit(path, init), env)
    return {
      res,
      body: await res.text(),
      cache: /page;dur=[\d.]+;desc=(\w+)/.exec(
        res.headers.get('server-timing') ?? '',
      )?.[1],
      timing: res.headers.get('server-timing') ?? '',
    }
  }
  return { scenario, env, space, app, cache, put, tool, open }
}

test('a public page is answered from the edge after its first view', async () => {
  let views = dataset()
  let { scenario, put, open } = await cookbook({ VIEWS: views })
  using _ = scenario
  let first = await open()
  assertEquals(first.res.status, 200)
  assertEquals(first.cache, 'MISS')
  assertStringIncludes(first.body, '<base href="/cookbook/">')
  assertStringIncludes(first.body, 'Made with ')
  // Changed under it with no directory write, the kept page is what answers,
  // and the app was not read for it.
  put('two')
  let again = await open()
  assertEquals(again.cache, 'HIT')
  assertEquals(again.body, first.body)
  assert(!/\bapp;/.test(again.timing), again.timing)
  assertEquals(again.res.headers.get('cache-control'), 'public, no-cache')
  for (let name of ['cache-tag', 'x-yak-seen', 'x-yak-browser-cache', 'age']) {
    assertEquals(again.res.headers.get(name), null, name)
  }
  let etag = again.res.headers.get('etag')!
  let fresh = await open('/cookbook/', { headers: { 'if-none-match': etag } })
  assertEquals(fresh.res.status, 304)
  let head = await open('/cookbook/', { method: 'HEAD' })
  assertEquals([head.res.status, head.body], [200, ''])
  // The two pages sent and the HEAD are views; the 304 sent none.
  assertEquals(views.points.length, 3)
})

test('a deploy, a setting and a plan change are each seen at once', async () => {
  let { scenario, env, space, tool, open } = await cookbook()
  using _ = scenario
  assertStringIncludes((await open()).body, 'one')
  assertEquals((await open()).cache, 'HIT')
  await tool('app_files', {
    files: [{ path: 'index.html', content: page('released') }],
  })
  await tool('app_deploy')
  let deployed = await open()
  assertEquals(deployed.cache, 'MISS')
  assertStringIncludes(deployed.body, 'released')
  await tool('app_set', { theme_color: '#1b3a2f' })
  assertStringIncludes(
    (await open()).body,
    '<meta name="theme-color" content="#1b3a2f">',
  )
  await stamp(env, {
    entities: [{ entity: { eid: space.eid }, plan: { tier: 'plus' } }],
  })
  let plus = await open()
  assertEquals(plus.cache, 'MISS')
  assert(!plus.body.includes('Made with '), plus.body)
})

test('a page made private leaves the edge, and its members are served it', async () => {
  let { scenario, cache, put, tool, open } = await cookbook()
  using _ = scenario
  await open()
  assertEquals(cache.pages(), 1)
  await tool('app_set', { access: 'private' })
  assertEquals(cache.pages(), 0)
  let stranger = await open()
  assertEquals(stranger.res.status, 303)
  put('members only')
  let cookie = await as(ADA)
  for (let _ of [1, 2]) {
    let member = await open('/cookbook/', { headers: { cookie } })
    assertStringIncludes(member.body, 'members only')
    assertStringIncludes(member.res.headers.get('cache-control')!, 'private')
  }
  assertEquals(cache.pages(), 0)
})

test("a sandboxed page and a worker's page are never kept", async () => {
  for (
    let patch of [
      { installed: { sandboxed: new Date().toISOString() } },
      { app: { worker: 'app-script' } },
    ]
  ) {
    let { scenario, env, app, cache, open } = await cookbook()
    using _ = scenario
    await stamp(env, { entities: [{ entity: { eid: app.eid }, ...patch }] })
    // Site is asked once, and about none of the app's other addresses after.
    assertEquals((await open()).res.status, 200)
    await open('/cookbook/another.html')
    assertEquals(cache.pages(), 0)
    assertEquals(cache.asks(), 1)
  }
})

test('a missing page is kept until a deploy writes it', async () => {
  let { scenario, tool, open } = await cookbook()
  using _ = scenario
  let missing = await open('/cookbook/later.html')
  assertEquals([missing.res.status, missing.cache], [404, 'MISS'])
  assertEquals((await open('/cookbook/later.html')).cache, 'HIT')
  await tool('app_files', {
    files: [{ path: 'later.html', content: page('later') }],
  })
  await tool('app_deploy')
  let written = await open('/cookbook/later.html')
  assertEquals(written.res.status, 200)
  assertStringIncludes(written.body, 'later')
})

test("a space's 404 is kept until an app takes the address", async () => {
  let { scenario, env, space, open } = await cookbook()
  using _ = scenario
  assertEquals((await open('/garden/')).res.status, 404)
  assertEquals((await open('/garden/')).cache, 'HIT')
  scenario.files.held.set(
    'ada/garden/index.html',
    new TextEncoder().encode(page('garden')),
  )
  await stamp(env, {
    entities: [{
      entity: { eid: '$app' },
      app: {
        slug: 'garden',
        space: space.eid,
        version: 1,
        access: 'public',
        store: 'ada/garden.ccc333',
        worker: '',
      },
    }],
  })
  let garden = await open('/garden/')
  assertEquals(garden.res.status, 200)
  assertStringIncludes(garden.body, 'garden')
})

test('two spaces at one path keep two pages', async () => {
  let { scenario, env, cache, open } = await cookbook()
  using _ = scenario
  await stamp(env, {
    entities: [
      {
        entity: { eid: '$space' },
        doc: { title: 'bob' },
        space: { slug: 'bob' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'Cookbook' },
        app: {
          slug: 'cookbook',
          space: '$space',
          version: 1,
          access: 'public',
          store: 'bob/cookbook.bbb222',
          worker: '',
        },
      },
    ],
  })
  scenario.files.held.set(
    'bob/cookbook/index.html',
    new TextEncoder().encode(page('bob')),
  )
  let bob = () =>
    apps.fetch(new Request('https://bob.yaks.app/cookbook/'), env)
      .then((r) => r.text())
  for (let _ of [1, 2]) {
    assertStringIncludes((await open()).body, 'one')
    assertStringIncludes(await bob(), 'bob')
  }
  assertEquals(cache.pages(), 2)
})

test('an answer that sets a cookie is never kept', async () => {
  let space = { eid: 's', slug: 'ada' }
  let app = { eid: 'a', slug: 'cookbook' }
  let cookie = new Response('hi', { headers: { 'set-cookie': 'a=b' } })
  let ok = new Response('hi')
  assertEquals((await kept(keep(cookie, space, app))).status, 204)
  assertEquals((await kept(keep(ok, space, app))).status, 200)
})
