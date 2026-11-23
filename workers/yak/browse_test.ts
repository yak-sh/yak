// The browse door (browse.ts): a page of ours opened in the browser signed in
// as its caller, for the platform's test accounts alone.
import { cleanup, clock, equal, match, test } from '@yaks/testing'
import {
  answer,
  type Browsing,
  MOST,
  type Visit,
} from '@yaks/platform/browser-visit'
import { actions } from './browser/testing.ts'
import { bearerFor, fresh, type Kernel, signIn } from './probe.ts'
import { HOST_COOKIE } from './browser-cookie.ts'
import { COOKIE, cookieValue } from '@yaks/platform/cookie'
import { ADMIN } from '@yaks/platform/bots'
import type { Comp } from '@yaks/graph'

let time = clock()
let visits: Visit[] = []
let did: string[] = []
let controls = actions((line) => did.push(line))
let browsing: Browsing = {
  acquire: () => Promise.resolve('session'),
  connect: () =>
    Promise.resolve({
      newPage: () =>
        Promise.resolve({
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
          on: () => {},
          setViewport: () => Promise.resolve(),
          emulateMediaFeatures: () => Promise.resolve(),
          setCookie: () => Promise.resolve(),
          goto: async (url) => {
            if (new URL(url).searchParams.has('slow')) await time.advance(3_000)
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
        }),
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
