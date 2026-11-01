// yak-front: what it answers itself from Site's cache, and that everything else
// and every failure of its own reach the kernel unchanged.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { type FrontEnv, serve, settled } from './front.ts'
import { pageAt, SEEN } from '../kept-page.ts'

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

let front = (site: (req: Request) => Response | Promise<Response>) => {
  let asked: string[] = [], forwarded: Request[] = [], used: string[] = []
  let points: unknown[] = [], errors: unknown[] = [], retained: unknown[] = []
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
        return Promise.resolve(new Response('kernel'))
      }) as never,
    },
    USES: {
      used: (eid) => {
        used.push(eid)
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
  return { go, asked, forwarded, used, points, errors, retained }
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
  ]
  for (let [url, init] of cases) {
    let f = front(() => page())
    let res = await f.go(url, init)
    assertEquals(await res.text(), 'kernel', url)
    assertEquals(f.asked, [], url)
    assertEquals(f.forwarded[0].url, url)
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
  let res = await f.go('https://yaks.app/')
  assertEquals(await res.text(), 'home')
  assertEquals(f.asked, ['https://site.invalid/yaks.app/'])
  assertEquals(
    res.headers.get('cache-control'),
    'public, max-age=30, must-revalidate',
  )
  assertEquals(res.headers.get('server-timing')!.includes('site_old'), false)
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
