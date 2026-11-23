// The browse door (browse.ts): a page of ours opened in the browser signed in
// as its caller, for the platform's test accounts alone.
import { cleanup, clock, equal, match, test } from '@yaks/testing'
import {
  answer,
  type BrowseFrame,
  type BrowseVisit,
  type Browsing,
  MOST,
  type PageRequest,
  type Visit,
} from '@yaks/platform/browser-visit'
import { MOCKUP_ORIGIN } from '@yaks/platform/browser-mockup'
import {
  frames,
  packet,
  readAsk,
  streamed,
  WIRE,
} from '@yaks/platform/browser-wire'
import { actions } from './browser/testing.ts'
import { bearerFor, fresh, type Kernel, signIn } from './probe.ts'
import { HOST_COOKIE } from './browser-cookie.ts'
import { COOKIE, cookieValue } from '@yaks/platform/cookie'
import { ADMIN } from '@yaks/platform/bots'
import type { Comp } from '@yaks/graph'

let time = clock()
let visits: Visit[] = []
let uploads: string[] = []
let posted: BrowseVisit[] = []
let openedFiles: [string, Parameters<PageRequest['respond']>[0] | 'network'][] =
  []
let did: string[] = []
let controls = actions((line) => did.push(line))
let browsing: Browsing = {
  acquire: () => Promise.resolve('session'),
  connect: () =>
    Promise.resolve({
      newPage: () => {
        let route: ((asked: PageRequest) => void) | undefined
        return Promise.resolve({
          ...controls,
          waitForSelector: async (selector, options) => {
            if (selector == '[data-not-now]') {
              await time.advance(options.timeout)
              throw new Error(
                `Waiting for selector \`${selector}\` failed: Waiting failed: ${options.timeout}ms exceeded`,
              )
            }
            let el = await controls.waitForSelector(selector, options)
            return el && selector == '#stalled'
              ? { ...el, tap: () => time.advance(MOST) }
              : el
          },
          on: (event, hear) => {
            if (event == 'request') route = hear as (asked: PageRequest) => void
          },
          setViewport: () => Promise.resolve(),
          emulateMediaFeatures: () => Promise.resolve(),
          setCookie: () => Promise.resolve(),
          goto: async (url) => {
            if (new URL(url).searchParams.has('slow')) await time.advance(3_000)
            if (new URL(url).origin == MOCKUP_ORIGIN) {
              for (
                let path of [
                  url,
                  '../theme.css?v=5',
                  './app.mjs',
                  '/img/hero%20%C3%A9.webp',
                  '/missing.css',
                  'https://cdn.example.com/icon.svg',
                ]
              ) {
                let address = new URL(path, url).href
                route!({
                  url: () => address,
                  isNavigationRequest: () => path == url,
                  frame: controls.mainFrame,
                  respond: (answer) => {
                    openedFiles.push([path, answer])
                    return Promise.resolve()
                  },
                  continue: () => {
                    openedFiles.push([path, 'network'])
                    return Promise.resolve()
                  },
                })
              }
            }
            return { status: () => 200 }
          },
          createCDPSession: () =>
            Promise.resolve({
              send: (method: string) =>
                Promise.resolve(
                  method == 'Page.getFrameTree'
                    ? { frameTree: { frame: { id: 'main' } } }
                    : method == 'Page.createIsolatedWorld'
                    ? { executionContextId: 1 }
                    : { result: { value: { violations: [], incomplete: [] } } },
                ),
            }),
          screenshot: () => Promise.resolve('png'),
        })
      },
    }),
  release: () => Promise.resolve(),
  axe: { source: '', version: 'test' },
}
let slow = answer(browsing, time)
let k: Kernel = await fresh({
  ERRORS: { send: () => Promise.resolve() },
}, (env) => {
  env.BROWSER = {
    fetch: async (req: Request) => {
      if (req.headers.get('content-type') == WIRE) {
        let file = await readAsk<BrowseVisit>(req.clone().body)
        posted.push(file.head)
        uploads.push(await new Response(file.body).text())
        return answer(browsing, clock())(req)
      }
      let visit: Visit = await req.clone().json()
      visits.push(visit)
      if (new URL(visit.url).searchParams.has('slow')) return slow(req)
      let elapsed = clock()
      let rendered = answer(browsing, elapsed)(req)
      await elapsed.advance(visit.view?.wait ?? 0)
      return rendered
    },
  } as unknown as typeof env.BROWSER
})
cleanup(() => k.stop())

// The kernel's first sign-in owns the platform's space.
let owner = k.owner
let checks = await signIn(
  k,
  `checks${crypto.randomUUID().slice(0, 6)}@bot.yak.sh`,
)
let stranger = await signIn(k)

let browse = (
  body: unknown,
  headers: Record<string, string>,
  path = '/api/browse',
) =>
  k.at(k.host, path, {
    method: 'POST',
    headers: { origin: `https://${k.host}`, ...headers },
    body: JSON.stringify(body),
  })
let manage = { url: `https://${k.host}/manage`, steps: [{ tap: 'textarea' }] }

let reportedBrowse = async (
  steps: Visit['steps'],
  url = `${manage.url}?slow`,
) => {
  let from = k.reported.length
  let r = await browse({ url, view: { wait: 0 }, steps }, {
    cookie: checks.cookie,
  })
  await k.flushReports()
  return {
    status: r.status,
    body: await r.json(),
    reports: k.reported.slice(from),
  }
}

test('a test account opens a page of ours signed in as itself, on a phone unless it names a window', async () => {
  let r = await browse(manage, { cookie: checks.cookie })
  equal(r.status, 200)
  equal((await r.json()).image, 'png')
  let visit = visits.at(-1)!
  let token = cookieValue(checks.cookie) ?? undefined
  equal(visit.url, `https://${k.host}/manage`)
  equal(visit.view, { width: 390, height: 844, wait: 1000, touch: true })
  equal(
    visit.cookies!.map((c) => [c.name, c.value, c.domain ?? c.url]),
    [
      [COOKIE, token, `.${k.host}`],
      [HOST_COOKIE, token, `https://${k.host}/`],
    ],
  )
  equal(did.slice(-2), ['find textarea', 'tap textarea'])
  // A check looks at the page; axe-core's audit is app_preview's.
  equal(visit.audit, false)
})

test('a test account opens a page as a stranger, holding no cookie', async () => {
  let r = await browse({ ...manage, signedOut: true }, {
    cookie: checks.cookie,
  })
  equal(r.status, 200)
  equal(visits.at(-1)!.cookies, [])
})

test('a page brought as a checkout renders it goes to the browser as its document, within bounds', async () => {
  let shown = await browse({ ...manage, html: '<p>draft</p>' }, {
    cookie: checks.cookie,
  })
  equal(shown.status, 200)
  equal(visits.at(-1)!.html, '<p>draft</p>')
  let huge = await browse({ ...manage, html: 'x'.repeat(4_000_001) }, {
    cookie: checks.cookie,
  })
  equal(huge.status, 413)
})

test('a checkout document and the screenshots stream through the kernel', async () => {
  let html = '<b>Draft 🌐</b>'
  let bytes = new TextEncoder().encode(html)
  let r = await k.at(k.host, '/api/browse', {
    method: 'POST',
    headers: {
      origin: `https://${k.host}`,
      cookie: checks.cookie,
      accept: WIRE,
      'content-type': WIRE,
    },
    body: packet({
      head: { ...manage, view: { wait: 0 }, steps: [{ shot: 'before' }] },
      size: bytes.length,
      body: streamed((async function* () {
        yield bytes.subarray(0, 10)
        yield bytes.subarray(10)
      })()),
    }),
  })
  equal(r.status, 200)
  equal(r.headers.get('content-type'), WIRE)
  let seen: unknown[] = []
  for await (let { head, body } of frames<BrowseFrame>(r.body)) {
    if (head.kind == 'shot') {
      seen.push([
        head.name,
        new Uint8Array(await new Response(body).arrayBuffer()),
      ])
    } else if (head.kind == 'result') {
      match(head.result, { status: 200, errors: [] })
      seen.push(head.kind)
    } else seen.push(head.kind)
  }
  let png = Uint8Array.fromBase64('png')
  equal(seen, ['reset', ['before', png], ['end', png], 'result'])
  equal(uploads.at(-1), html)
  equal(did.includes('intercept true'), true)
})

test('a directory visit serves the page and its assets without account cookies', async () => {
  let contents = [
    ['/pages/index.html', new TextEncoder().encode('<h1>Mockup</h1>')],
    ['/theme.css', new TextEncoder().encode('h1 { color: red }')],
    ['/img/hero é.webp', new Uint8Array([0, 255, 12, 99])],
    ['/pages/app.mjs', new Uint8Array()],
  ] as const
  let size = contents.reduce((n, [, bytes]) => n + bytes.length, 0)
  let url = MOCKUP_ORIGIN + '/pages/'
  let r = await k.at(k.host, '/api/browse', {
    method: 'POST',
    headers: {
      origin: `https://${k.host}`,
      cookie: checks.cookie,
      accept: WIRE,
      'content-type': WIRE,
    },
    body: packet({
      head: {
        url,
        view: { wait: 0 },
        mockup: contents.map(([path, bytes]) => ({ path, size: bytes.length })),
      },
      size,
      body: streamed((async function* () {
        for (let [, bytes] of contents) yield bytes
      })()),
    }),
  })
  equal(r.status, 200)
  for await (let { head, body } of frames<BrowseFrame>(r.body)) {
    if (body) await new Response(body).arrayBuffer()
    if (head.kind == 'result') match(head.result, { status: 200, errors: [] })
  }
  equal(posted.at(-1)!.cookies, [])
  equal(openedFiles, [
    [url, {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: contents[0][1],
    }],
    ['../theme.css?v=5', {
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: contents[1][1],
    }],
    ['./app.mjs', {
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: contents[3][1],
    }],
    ['/img/hero%20%C3%A9.webp', {
      status: 200,
      contentType: 'image/webp',
      body: contents[2][1],
    }],
    ['/missing.css', {
      status: 404,
      contentType: 'text/plain',
      body: 'File not found',
    }],
    ['https://cdn.example.com/icon.svg', 'network'],
  ])
})

test('a person never lends their sign-in to the browser, not even the platform owner', async () => {
  let r = await browse(manage, { cookie: owner.cookie })
  equal(r.status, 403)
})

test('a window named is the one opened', async () => {
  let r = await browse(
    { ...manage, view: { width: 1280, height: 800, touch: false } },
    { cookie: checks.cookie },
  )
  equal(r.status, 200)
  equal(visits.at(-1)!.view, {
    width: 1280,
    height: 800,
    wait: 1000,
    touch: false,
  })
})

test('the admin bot visits the directory without giving the browser an account session', async () => {
  let bot = await signIn(k, ADMIN)
  let page = '/admin/people'
  let asked = { url: `https://${k.host}${page}` }
  let headers = { authorization: `Bearer ${await bearerFor(k, bot.cookie)}` }
  let door = '/api/browse/admin'
  equal((await browse(asked, { cookie: checks.cookie }, door)).status, 403)
  equal((await browse(asked, { cookie: owner.cookie }, door)).status, 403)
  equal((await browse(manage, headers, door)).status, 403)
  equal((await browse(asked, headers, door)).status, 200)
  let [cookie] = visits.at(-1)!.cookies!
  equal(visits.at(-1)!.cookies!.length, 1)
  match(cookie, { path: '/admin', secure: true, httpOnly: true })
  equal(cookie.domain, undefined)
  let visit = { cookie: `${cookie.name}=${cookie.value}` }
  equal((await k.at(k.host, page, { headers: visit })).status, 200)
  let account = await k.at(k.host, '/manage', {
    headers: { cookie: `${HOST_COOKIE}=${cookie.value}` },
    redirect: 'manual',
  })
  equal(account.status, 303)
  equal(new URL(account.headers.get('location')!, asked.url).pathname, '/login')
})

test('a page opens holding the permissions asked for, as a person who allowed them', async () => {
  did.length = 0
  let r = await browse(
    { url: manage.url, allow: ['notifications', 7] },
    { cookie: checks.cookie },
  )
  equal(r.status, 200)
  equal(visits.at(-1)!.allow, ['notifications'])
  equal(did, [`allow notifications on https://${k.host}`])
})

test('a person, a bearer and a page off our zone are each refused', async () => {
  let seen = visits.length
  equal((await browse(manage, { cookie: stranger.cookie })).status, 403)
  equal((await browse(manage, { authorization: 'Bearer x' })).status, 401)
  equal(
    (await browse({ url: 'https://example.com/' }, { cookie: checks.cookie }))
      .status,
    400,
  )
  equal(visits.length, seen)
})

test('a visit whose requested waits exceed its deadline is refused without opening a browser', async () => {
  let seen = visits.length
  let r = await browse(
    { url: manage.url, steps: [{ wait: 60_000 }] },
    { cookie: checks.cookie },
  )
  equal(r.status, 400)
  equal((await r.json()).error.code, 'browser_wait_too_long')
  equal(visits.length, seen)
})

test('a missing visible element is a refusal naming the step and selector', async () => {
  let { status, body, reports } = await reportedBrowse([{
    tap: '[data-not-now]',
  }])
  equal(status, 400)
  equal(body.error.code, 'browser_wait_expired')
  equal(
    body.error.message,
    'Step 1 waited for a visible element matching [data-not-now].',
  )
  equal(reports, [])
})

test('a stalled action reports its page, caller and step without preview credentials', async () => {
  let url = `https://${k.host}/app/~preview-code/?slow=private-value#private`
  let { status, body, reports } = await reportedBrowse([
    { shot: 'first' },
    { shot: 'before' },
    { tap: '#stalled' },
  ], url)
  equal(status, 504)
  equal(
    body.error.message,
    'Browser visit while taking step 3 (tapping the element) timed out after 20 seconds',
  )
  let error = reports.find((row) => row.error)?.error as Comp | undefined
  let tags = error?.tags
  match(tags, {
    request: 'POST /api/browse',
    browse_page: `https://${k.host}/app/<preview>`,
    browse_caller: checks.person,
    browse_input: 'touch',
  })
})
