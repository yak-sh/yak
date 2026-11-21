// A page of ours opened in Cloudflare's browser (yak-browser, browser/), signed
// in as whoever asks, and the steps a person would take on it: the door an
// agent checking yaks.app live drives a browser through, since the box it runs
// on has none (T-1637). It answers what the browser visit renders: the
// screenshots, the page's text, console, errors and status.
//
// Test accounts browse with their session cookie. The private admin door
// accepts the admin bot's OAuth grant and issues a short-lived directory
// credential for the browser.
//
// Only the fleet's test accounts and the platform's owners may ask: the
// browser time is the platform's, spent checking the platform. Only pages on
// our own zone are opened, the hosts the cookie belongs to.
import { COOKIE, cookieValue } from '@yaks/platform/cookie'
import { apex } from '@yaks/platform/host'
import { ADMIN as ADMIN_BOT, isTestAddress } from '@yaks/platform/bots'
import {
  ADMIN,
  ADMIN_BROWSE,
  adminPage,
  BROWSE,
  onZone,
} from '@yaks/platform/routes'
import * as dirPart from './directory.ts'
import { type Directory, directory } from './directory.ts'
import { bound, type Env } from './env.ts'
import { sessionAt } from './session.ts'
import { HOST_COOKIE, sessionCookie } from './browser-cookie.ts'
import { opened, seal } from './lib/token.ts'
import { adminWho } from './asking.ts'
import { caught } from './defects.ts'
import { system } from '@yaks/fp'
import { CallError, refused } from '@yaks/tools/errors'
import {
  bounded,
  type Cookie,
  MOST,
  type Step,
  type View,
  waiting,
} from '@yaks/platform/browser-visit'
import { seen, timedOut } from './browser.ts'

export let PATH = BROWSE
export let ADMIN_PATH = ADMIN_BROWSE

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

/** What a caller posts: the page, its window and the steps taken on it. */
export type Asked = {
  url: string
  view?: Partial<View>
  steps?: Step[]
  allow?: string[]
}

// A phone's window unless the caller names another.
let PHONE: View = { width: 390, height: 844, wait: 1000, touch: true }

// The caller's session, as the cookies a browser signed in at the apex holds:
// the shared one every space's host reads, and the apex's own (browser-
// cookie.ts `HOST_COOKIE`).
let held = (token: string, env: Env): Cookie[] => [
  {
    name: COOKIE,
    value: token,
    domain: `.${apex(env)}`,
    path: '/',
    secure: true,
    httpOnly: true,
  },
  {
    name: HOST_COOKIE,
    value: token,
    url: `https://${apex(env)}/`,
    path: '/',
    secure: true,
    httpOnly: true,
  },
]

let ADMIN_COOKIE = '__Secure-yak_admin_browse'
type AdminVisit = { person: string; until: number }

// The private forwarder authenticates the request. The remote browser only
// gets a short-lived cookie for reading admin pages, even if a step leaves
// the directory or follows a link into an app.
let adminCookie = async (env: Env, person: string): Promise<Cookie> => ({
  name: ADMIN_COOKIE,
  value: await seal(
    'admin-browse',
    {
      person,
      until: Date.now() + 60_000,
    } satisfies AdminVisit,
    env.SESSION_SECRET!,
  ),
  url: `https://${apex(env)}${ADMIN}`,
  path: ADMIN,
  secure: true,
  httpOnly: true,
})

export let browsingAdmin = async (req: Request, env: Env) => {
  let token = cookieValue(req.headers.get('cookie'), ADMIN_COOKIE)
  if (!token || !env.SESSION_SECRET) return null
  let visit = await opened<AdminVisit>(
    'admin-browse',
    token,
    env.SESSION_SECRET,
  )
  return visit && visit.until > Date.now() ? visit.person : null
}

let pageAddress = (url: string) => {
  let { origin, pathname } = new URL(url)
  let path = pathname.replace(/\/(?:~[^/]+|_preview\/[^/]+).*$/, '/<preview>')
  return (origin + path).slice(0, 250)
}

let adminCaller = async (req: Request, env: Env, dir: Directory) => {
  let meta = await dir.space(dirPart.META.space)
  if (!meta || !env.SESSION_SECRET) {
    return json(
      503,
      'no_platform',
      'admin visits require a configured platform',
    )
  }
  let who = await adminWho(env, req, (person) => dir.role(meta, person))
  if (
    !who.person || who.role != 'owner' ||
    who.person != await dir.personAt(ADMIN_BOT)
  ) {
    return json(403, 'admin_account', 'choose the platform admin bot')
  }
  return { person: who.person, token: null }
}

let sessionCaller = async (req: Request, env: Env, dir: Directory) => {
  let claims = await sessionAt(req, env, null, dir)
  let token = sessionCookie(req, env)
  if (!claims || !token) {
    return json(
      401,
      'unauthorized',
      'sign in: this door takes a session cookie',
    )
  }
  let known = await dir.known(claims.person)
  let permitted = isTestAddress(known?.email ?? '')
  if (!permitted) {
    let meta = await dir.space(dirPart.META.space)
    permitted = !!meta && await dir.role(meta, claims.person) == 'owner'
  }
  if (!permitted) {
    return json(
      403,
      'not_a_test_account',
      'the browser is for the platform’s test accounts and owners',
    )
  }
  return {
    person: claims.person,
    token: known?.email == ADMIN_BOT ? null : token,
  }
}

let visitOf = async (req: Request, env: Env, path: string) => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let caller = await (path == ADMIN_PATH ? adminCaller : sessionCaller)(
    req,
    env,
    dir,
  )
  if (caller instanceof Response) return caller
  let { person, token } = caller
  let asked = await req.json().catch(() => null) as Asked | null
  let url = typeof asked?.url == 'string' && /^https:/.test(asked.url) &&
    onZone(asked.url, env)
  if (!asked || !url) {
    return json(400, 'off_zone', `name an https address on ${apex(env)}`)
  }
  if (!token && !adminPage(url, env)) {
    return json(403, 'admin_page', `choose an ${ADMIN} page on ${apex(env)}`)
  }
  let visit = {
    url,
    view: { ...PHONE, ...asked.view },
    cookies: token ? held(token, env) : [await adminCookie(env, person)],
    steps: Array.isArray(asked.steps) ? asked.steps : [],
    allow: Array.isArray(asked.allow)
      ? asked.allow.filter((p) => typeof p == 'string')
      : [],
    // axe-core belongs to app_preview. A browser visit reads the page and
    // takes the steps it was asked to take.
    audit: false,
  }
  if (waiting(visit) >= MOST) {
    return json(
      400,
      'browser_wait_too_long',
      `The requested waits use up the visit's ${
        MOST / 1000
      }-second wait limit. Shorten the waits or split the visit.`,
    )
  }
  return { visit, person }
}

export let fetch = async (
  req: Request,
  env: Env,
  path = PATH,
): Promise<Response> => {
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'post a visit')
  }
  let where = { request: `POST ${path}` }
  try {
    let asked = await bounded(
      env.CLOCK ?? system,
      5_000,
      () => 'Reading and authorizing the browser visit',
      () => visitOf(req, env, path),
    )
    if (asked instanceof Response) return asked
    let { visit, person } = asked
    Object.assign(where, {
      browse_page: pageAddress(visit.url),
      browse_caller: person,
      browse_input: visit.view.touch ? 'touch' : 'mouse',
    })
    return Response.json(await seen(env, visit, undefined, where))
  } catch (e) {
    if (e instanceof CallError) return refused(e)
    caught(e, where)
    if (timedOut(e)) return json(504, 'browser_timeout', (e as Error).message)
    return json(502, 'browser_failed', (e as Error).message)
  }
}
