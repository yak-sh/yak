// A page of ours opened in Cloudflare's browser (yak-browser, browser/), signed
// in as whoever asks, and the steps a person would take on it: the door an
// agent checking yaks.app live drives a browser through, since the box it runs
// on has none (T-1637). It answers what browser/capture.ts renders: the
// screenshots, the page's text, console, errors and status.
//
// It is the browser's own credential that opens it, the session cookie, and
// that same cookie is what the page is opened with, so a visit can do nothing
// its caller could not do in a browser of their own. A bearer opens nothing
// here, for the reason a standing link takes only a cookie (identity.ts): an
// agent's API access never becomes a browser session.
//
// Only the fleet's test accounts and the platform's owners may ask: the
// browser time is the platform's, spent checking the platform. Only pages on
// our own zone are opened, the hosts the cookie belongs to.
import { COOKIE } from '@yaks/platform/cookie'
import { apex } from '@yaks/platform/host'
import { isTestAddress } from '@yaks/platform/bots'
import { onZone } from '@yaks/platform/routes'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { bound, type Env } from './env.ts'
import { sessionAt } from './session.ts'
import { HOST_COOKIE, sessionCookie } from './browser-cookie.ts'
import { caught } from './defects.ts'
import type { Cookie, Step, View } from './browser/capture.ts'

export let PATH = '/api/browse'

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

/** What a caller posts: the page, its window and the steps taken on it. */
export type Asked = { url: string; view?: Partial<View>; steps?: Step[] }

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

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'post a visit')
  }
  let claims = await sessionAt(req, env)
  let token = sessionCookie(req, env)
  if (!claims || !token) {
    return json(
      401,
      'unauthorized',
      'sign in: this door takes a session cookie',
    )
  }
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let known = await dir.known(claims.person)
  let meta = await dir.space(dirPart.META.space)
  let owner = meta && await dir.role(meta, claims.person) == 'owner'
  if (!owner && !isTestAddress(known?.email ?? '')) {
    return json(
      403,
      'not_a_test_account',
      'the browser is for the platform’s test accounts and owners',
    )
  }
  let asked = await req.json().catch(() => null) as Asked | null
  let url = typeof asked?.url == 'string' && /^https:/.test(asked.url) &&
    onZone(asked.url, env)
  if (!asked || !url) {
    return json(400, 'off_zone', `name an https address on ${apex(env)}`)
  }
  let view = { ...PHONE, ...asked.view }
  let { render } = await import('./browser.ts')
  try {
    return Response.json(
      await render(
        env,
        {
          url,
          view,
          cookies: held(token, env),
          steps: Array.isArray(asked.steps) ? asked.steps : [],
        },
        undefined,
        { request: `POST ${PATH}` },
      ),
    )
  } catch (e) {
    caught(e, { request: `POST ${PATH}` })
    return json(502, 'browser_failed', (e as Error).message)
  }
}
