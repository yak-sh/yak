// yak-front: what it answers itself from Site's cache, and that everything else
// and every failure of its own reach the kernel unchanged.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { type FrontEnv, serve, settled } from './front.ts'
import { pageAt, SEEN } from '../kept-page.ts'
import type { Conversion } from '../arrival.ts'
import { COOKIE } from '../variant.ts'

// A visitor who already holds today's home page, where the home page is split
// (variant.ts).
let held = `${COOKIE}=ask`

let body = (claims: unknown) => `${btoa(JSON.stringify(claims))}.mac`
let days = (n: number) => Date.now() / 1000 + n * 24 * 60 * 60
let at = 'https://ada.yaks.app/cookbook/'
let seen = JSON.stringify({ app: 'a', space: 'ada', slug: 'cookbook' })

let page = (headers: Record<string, string> = {}) =>
  new Response('<body>kept</body>', {
    headers: {
      'content-type': 'text/html',
      'cf-cache-status': 'HIT',
      etag: '"v1"',
      'x-yak-browser-cache': 'public, no-cache',
      'cache-tag': 'a,s',
      age: '5',
      'server-timing': 'site_old;dur=9',
      [SEEN]: seen,
      ...headers,
    },
  })

let front = (
  site: (req: Request) => Response | Promise<Response>,
  kernel = () => new Response('kernel'),
) => {
  let asked: string[] = [], forwarded: Request[] = [], used: string[] = []
  let points: unknown[] = [], errors: unknown[] = [], retained: unknown[] = []
  let told: Conversion[] = []
  let env: FrontEnv = {
    APEX: 'yaks.app',
    SITE: {
      fetch: ((req: Request) => {
        asked.push(req.url)
        return Promise.resolve(site(req))
      }) as never,
    },
    KERNEL: {
      fetch: ((req: Request) => {
        forwarded.push(req)
        return Promise.resolve(kernel())
      }) as never,
    },
    USES: {
      used: (eid) => {
        used.push(eid)
        return Promise.resolve()
      },
    },
    ADS: {
      told: (c) => {
        told.push(c)
        return Promise.resolve()
      },
    },
    VIEWS: { writeDataPoint: (point) => points.push(point) },
    ERRORS: {
      send: ((rows: unknown) => {
        errors.push(rows)
        return Promise.resolve()
      }) as never,
    },
  }
  let go = (url: string, init?: RequestInit) =>
    serve(new Request(url, init), env, {
      waitUntil: (work) => retained.push(work),
    })
  return { go, env, asked, forwarded, used, points, errors, retained, told }
}

test('a kept page answers from the edge with no kernel, counted once', async () => {
  let f = front(() => page())
  let res = await f.go(at)
  assertEquals(await res.text(), '<body>kept</body>')
  assertEquals(f.asked, [pageAt('ada.yaks.app', '/cookbook/', null)])
  assertEquals(f.forwarded.length, 0)
  assertEquals(res.headers.get('cache-control'), 'public, no-cache')
  for (let name of [SEEN, 'cf-cache-status', 'cache-tag', 'age']) {
    assertEquals(res.headers.get(name), null)
  }
  assertStringIncludes(res.headers.get('strict-transport-security')!, 'max-age')
  assertStringIncludes(res.headers.get('server-timing')!, 'front;dur=')
  assertEquals(res.headers.get('server-timing')!.includes('site_old'), false)
  assertStringIncludes(
    res.headers.get('content-security-policy')!,
    "frame-ancestors 'self' https://yaks.app",
  )
  assertEquals(f.used, ['a'])
  assertEquals(f.points.length, 1)
  // The next view in this isolate owes no second receipt for the hour.
  await f.go(at)
  assertEquals(f.used, ['a'])
  assertEquals(f.points.length, 2)
})

// A kept forward is kept by its path alone; the visitor's query goes on with
// them, so an ad's `utm_*` reaches the page it points at.
test("a kept forward keeps the visitor's query", async () => {
  let f = front(() => page({ location: '/cookbook/' }))
  let res = await f.go('https://ada.yaks.app/cookbook?utm_source=x')
  assertEquals(f.asked, [pageAt('ada.yaks.app', '/cookbook', null)])
  assertEquals(res.headers.get('location'), '/cookbook/?utm_source=x')
})

test('a revalidation is a 304 and a HEAD has no body', async () => {
  let f = front(() => page())
  let same = await f.go(at, { headers: { 'if-none-match': '"v1"' } })
  assertEquals(same.status, 304)
  let head = await f.go(at, { method: 'HEAD' })
  assertEquals(head.status, 200)
  assertEquals(await head.text(), '')
})

test('what no kept page may answer goes to the kernel without asking Site', async () => {
  let cases: [string, RequestInit?][] = [
    ['https://ada.yaks.app/cookbook/api/query'],
    ['https://ada.yaks.app/cookbook/~token/index.html'],
    ['https://ada.yaks.app/cookbook/', { method: 'POST', body: 'x' }],
    ['https://ada.yaks.app/cookbook/', { headers: { authorization: 'x' } }],
    ['https://ada.yaks.app/cookbook/', { headers: { range: 'bytes=0-1' } }],
    ['https://ada.yaks.app/cookbook/', { headers: { 'x-yak-grant': 'x' } }],
    ['https://ada.yaks.app/cookbook/', { headers: { upgrade: 'websocket' } }],
    ['https://ada.yaks.app/.well-known/thing'],
    ['https://ada.yaks.app/cookbook.git/info/refs'],
    ['https://ada.yaks.app/cookbook/info/refs'],
    ['https://ada.yaks.app/_yaks/hooks/x'],
    ['https://their-domain.com/'],
    ['https://a.b.yaks.app/'],
    ['https://yaks.app/login'],
    ['https://yaks.app/mcp'],
    ['https://yaks.app/docs/querying.md'],
    ['https://yaks.app/docs/a/b'],
  ]
  for (let [url, init] of cases) {
    let f = front(() => page())
    let res = await f.go(url, init)
    assertEquals(await res.text(), 'kernel', url)
    assertEquals(f.asked, [], url)
    assertEquals(f.forwarded[0].url, url)
  }
})

test("an app's fixed bytes answer from the edge; its other API doors never do", async () => {
  let release = 'fdcc9a38-0b6b-4f8c-bcbd-15bad97cee69'
  let kept = [
    `/cookbook/api/assets/${release}/app.js`,
    `/api/assets/${release}/styles/main.css`,
    '/cookbook/api/client.js',
    '/cookbook/api/_wire.js',
  ]
  for (let path of kept) {
    let f = front(() => page({ 'content-type': 'text/javascript' }))
    let res = await f.go(`https://ada.yaks.app${path}`)
    assertEquals(await res.text(), '<body>kept</body>', path)
    assertEquals(f.forwarded.length, 0, path)
    assertEquals(f.points.length, 0, path) // bytes, not a page view
  }
  // The hop a release's module takes back out to the API is kept as it is
  // sent: the visitor's browser follows it.
  let hop = front(() =>
    new Response(null, {
      status: 302,
      headers: { location: '../../../client.js', [SEEN]: seen },
    })
  )
  let res = await hop.go(
    `https://ada.yaks.app/cookbook/api/assets/${release}/api/client.js`,
  )
  assertEquals([res.status, res.headers.get('location')], [
    302,
    '../../../client.js',
  ])
  for (
    let path of [
      `/cookbook/api/assets/${release}`,
      '/cookbook/api/assets/not-a-release/app.js',
      '/cookbook/api/blob/abc',
      '/cookbook/api/client.json',
    ]
  ) {
    let f = front(() => page())
    assertEquals(
      await (await f.go(`https://ada.yaks.app${path}`)).text(),
      'kernel',
      path,
    )
    assertEquals(f.asked, [], path)
  }
})

test('an address Site passes goes to the kernel, and is not asked again', async () => {
  let f = front(() =>
    new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'public, max-age=30, stale-while-revalidate=86400',
      },
    })
  )
  assertEquals(await (await f.go(at)).text(), 'kernel')
  assertEquals(await (await f.go(at)).text(), 'kernel')
  assertEquals(f.asked.length, 1)
})

test('a broken Site is reported and answered by the kernel', async () => {
  let f = front(() => {
    throw new Error('site fell over')
  })
  assertEquals(await (await f.go(at)).text(), 'kernel')
  await Promise.all(f.retained)
  assertEquals(f.errors.length, 1)
})

test("a listing Site fails to render is the kernel's to answer", async () => {
  let f = front(() => new Response('broken', { status: 500 }))
  assertEquals(await (await f.go('https://yaks.app/')).text(), 'kernel')
})

// yak-front deploys before the kernel (wrangler.ts `SIBLINGS`), so for a while
// it may list a page the Site it asks doesn't keep yet.
test('an apex page Site refuses is answered by the kernel, reported when it serves it', async () => {
  let lost = () => new Response('lost', { status: 404 })
  let f = front(lost)
  let res = await f.go('https://yaks.app/pricing')
  assertEquals([res.status, await res.text()], [200, 'kernel'])
  await Promise.all(f.retained)
  assertEquals(f.errors.length, 1)
  let missing = front(lost, lost)
  res = await missing.go('https://yaks.app/docs/nowhere')
  assertEquals([res.status, await res.text()], [404, 'lost'])
  await Promise.all(missing.retained)
  assertEquals(missing.errors.length, 0)
})

test("the apex's listings come from Site, with their own lifetime", async () => {
  let f = front(() =>
    new Response('home', {
      headers: {
        'content-type': 'text/html',
        'cf-cache-status': 'HIT',
        'cache-control': 'public, max-age=30, stale-while-revalidate=86400',
        'server-timing': 'site_old;dur=9',
      },
    })
  )
  let res = await f.go('https://yaks.app/', { headers: { cookie: held } })
  assertEquals(await res.text(), 'home')
  assertEquals(f.asked, ['https://site.invalid/yaks.app/'])
  assertEquals(
    res.headers.get('cache-control'),
    'public, max-age=30, must-revalidate',
  )
  assertEquals(res.headers.get('server-timing')!.includes('site_old'), false)
})

test("the apex's static pages and the guide's come from Site", async () => {
  for (let path of ['/pricing', '/terms', '/docs', '/docs/querying']) {
    let f = front(() =>
      new Response(path, { headers: { 'cf-cache-status': 'HIT' } })
    )
    let res = await f.go(`https://yaks.app${path}?utm_source=x`)
    assertEquals(await res.text(), path)
    assertEquals(f.asked, [`https://site.invalid/yaks.app${path}`])
    assertEquals(f.forwarded.length, 0)
  }
})

test("a listing an ad's click opened keeps its arrival and hands the kernel the view", async () => {
  let home = () =>
    new Response('home', { headers: { 'content-type': 'text/html' } })
  let f = front(home)
  let ua = { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit Safari' }
  let res = await f.go('https://yaks.app/?fbclid=Ab1&utm_source=meta', {
    headers: ua,
  })
  assertEquals(await res.text(), 'home')
  assertStringIncludes(res.headers.get('set-cookie')!, 'yak_came=fbclid=Ab1')
  assertEquals(f.told.map((c) => [c.told, c.url]), [[
    'view',
    'https://yaks.app/',
  ]])
  assertEquals(f.retained.length, 1)
  // A visit no ad sent keeps nothing and tells nobody.
  let plain = front(home)
  let none = await plain.go('https://yaks.app/', {
    headers: { ...ua, cookie: held },
  })
  assertEquals(none.headers.get('set-cookie'), null)
  assertEquals(plain.told, [])
})

test('a cookie that owes something from the kernel routes there', () => {
  let asked = (cookie?: string) =>
    settled(
      new Request(at, cookie ? { headers: { cookie } } : {}),
    )
  assertEquals(asked(), true)
  assertEquals(asked(`other=1`), true)
  let session = (claims: unknown) => `yak_session=${body(claims)}`
  assertEquals(asked(session({ via: 'v', exp: days(80) })), true)
  assertEquals(
    asked(session({ person: 'p', space: null, via: 'v', exp: days(80) })),
    true,
  )
  // Past half its life, a session with no browser in it, and what isn't ours.
  assertEquals(asked(session({ via: 'v', exp: days(10) })), false)
  assertEquals(asked(session({ person: 'p', exp: days(80) })), false)
  assertEquals(asked('yak_session=!!!'), false)
})

test("an app the kernel says is never kept isn't asked about again", async () => {
  let f = front(() => {
    throw new Error('Site was asked')
  })
  let env = f.env
  env.KERNEL = {
    fetch: (() =>
      Promise.resolve(
        new Response('private', { headers: { 'x-yak-unkept': '/cookbook/' } }),
      )) as never,
  }
  env.SITE = {
    fetch: ((req: Request) => {
      f.asked.push(req.url)
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as never,
  }
  let first = await f.go('https://ada.yaks.app/cookbook/a')
  assertEquals(first.headers.get('x-yak-unkept'), null)
  assertEquals(f.asked.length, 1)
  await f.go('https://ada.yaks.app/cookbook/b')
  assertEquals(f.asked.length, 1)
})
