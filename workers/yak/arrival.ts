// Where a visit to yaks.app came from, as the link that brought it says: its
// `utm_*` tags and an ad network's click id (a `…clid` parameter, the one an
// ad network appends to the link it sent someone along). The first page a link
// opens keeps them in a cookie of their own on the apex, so a sign-up minutes
// later still says which campaign, and which click, it came from. A link with
// neither keeps nothing, and a later link that carries them replaces them.
// A home page opened (variant.ts) is kept in the same cookie, beside the
// tags, so the click, the build and the sign-up that follow a visit to
// /churches count under the church page; the home page opened last is the one
// kept. A link from an app's badge names that app (`?app=`, @yaks/platform/woven
// `badgeOf`), kept the same way.
//
// A sign-up keeps the arrival it carried on the person (`arrivedOf`, the
// directory's `arrived`), so where somebody came from outlives the cookie.
// The funnel counts its steps by the campaign and the home page (funnel.ts),
// and an ad network is told of a visit its click brought (conversions.ts).
// Nothing here imports past @yaks/platform/cookie, @yaks/platform/names,
// @yaks/platform/visitor and variant.ts, so yak-front (front/) holds it.
import { isPerson } from '@yaks/platform/visitor'
import { shown, VARIANTS } from './variant.ts'
import { cookieValue } from '@yaks/platform/cookie'
import { INVITED } from '@yaks/platform/names'

/** The cookie an arrival is kept in, apart from the session's. */
export let COOKIE = 'yak_came'

/** How long an arrival is kept: an ad network's own window for a click. */
export let DAYS = 90

let TAG = /^utm_(source|medium|campaign|content|term)$/
let CLICK = /^[a-z]{1,8}clid$/

// A value is whatever the link said, so it is capped rather than trusted.
let CAP = 200

/** An arrival: the tags and click ids its link carried, when, in ms, the
 * name of the home page its visitor opened last, if any, the app whose
 * badge the link was, if it was one, and the code of the invite link that
 * brought them, if one did. */
export type Came = {
  at: number
  said: Record<string, string>
  page?: string
  app?: string
  invite?: string
}

let EID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
let appIn = (q: URLSearchParams) => {
  let app = q.get('app')?.toLowerCase()
  return app && EID.test(app) ? app : undefined
}

let CODE = /^[a-z0-9]{4,12}$/
let codeOf = (code?: string | null) => {
  let c = code?.toLowerCase()
  return c && CODE.test(c) ? c : undefined
}

/// inviteAt('/i/K7q2m') -> 'k7q2m'
/// inviteAt('/i/k7q2m/') -> 'k7q2m'
/// inviteAt('/i/') -> undefined
/// inviteAt('/login') -> undefined
/** The code a person's invite link carries in its path, or undefined for any
 * other path. */
export let inviteAt = (path: string) =>
  path.startsWith(INVITED)
    ? codeOf(path.slice(INVITED.length).replace(/\/$/, ''))
    : undefined

/**
 * What an address says of where it came from, or null when it says nothing.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let url = new URL('https://yaks.app/?utm_source=meta&fbclid=Ab1&q=x')
 * assertEquals(cameFrom(url, 5), {
 *   at: 5,
 *   said: { utm_source: 'meta', fbclid: 'Ab1' },
 * })
 * assertEquals(cameFrom(new URL('https://yaks.app/?q=x')), null)
 * let app = '6f1c1b3e-0b5e-4c4a-9d1a-2b8f8c1d7e10'
 * assertEquals(cameFrom(new URL(`https://yaks.app/?app=${app}`), 5), {
 *   at: 5,
 *   said: {},
 *   app,
 * })
 * assertEquals(cameFrom(new URL('https://yaks.app/?app=recipes')), null)
 * assertEquals(cameFrom(new URL('https://yaks.app/i/k7q2m?utm_source=agent-check'), 5), {
 *   at: 5,
 *   said: { utm_source: 'agent-check' },
 *   invite: 'k7q2m',
 * })
 * ```
 */
export let cameFrom = (url: URL, now = Date.now()): Came | null => {
  let said: Record<string, string> = {}
  for (let [k, v] of url.searchParams) {
    if ((TAG.test(k) || CLICK.test(k)) && v) said[k] = v.slice(0, CAP)
  }
  let app = appIn(url.searchParams)
  let invite = inviteAt(url.pathname)
  return Object.keys(said).length || app || invite
    ? came(now, said, undefined, app, invite)
    : null
}

let read = (value: string): Came | null => {
  let q = new URLSearchParams(value), at = Number(q.get('at'))
  let page = VARIANTS.find((v) => v.name == q.get('page'))?.name
  let invite = codeOf(q.get('invite'))
  q.delete('at'), q.delete('page'), q.delete('invite')
  let link = cameFrom(new URL(`https://x/?${q}`), at)
  if (!Number.isFinite(at) || at <= 0) return null
  return page || link || invite
    ? came(at, link?.said ?? {}, page, link?.app, invite)
    : null
}

let came = (
  at: number,
  said: Record<string, string>,
  page?: string,
  app?: string,
  invite?: string,
): Came => ({
  at,
  said,
  ...page ? { page } : {},
  ...app ? { app } : {},
  ...invite ? { invite } : {},
})

let held = (req: Request) => {
  let cookie = cookieValue(req.headers.get('cookie'), COOKIE)
  return cookie ? read(cookie) : null
}

// What a request's own address says, read once, so the arrival it keeps and
// the one it tells of are one and the same moment.
let landed = new WeakMap<Request, Came | null>()
let landing = (req: Request) => {
  if (!landed.has(req)) landed.set(req, cameFrom(new URL(req.url)))
  return landed.get(req)!
}

/**
 * The arrival a request carries: its own address's tags, else its cookie's,
 * and the home page it opens, else the one its cookie keeps. A link with
 * tags replaces the whole arrival, the page kept with it too.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = (path: string, cookie = '') =>
 *   new Request(`https://yaks.app${path}`, { headers: { cookie } })
 * assertEquals(arrival(at('/churches'))?.page, 'church')
 * assertEquals(arrival(at('/login', 'yak_came=page=church&at=5'))?.page, 'church')
 * assertEquals(arrival(at('/login?utm_source=x', 'yak_came=page=church&at=5'))?.page, undefined)
 * assertEquals(arrival(at('/login')), null)
 * assertEquals(arrival(at('/', 'yak_came=invite=k7q2m&at=5'))?.invite, 'k7q2m')
 * ```
 */
export let arrival = (req: Request): Came | null => {
  let link = landing(req), kept = link ? null : held(req)
  let page = shown(req)?.name ?? kept?.page
  let from = link ?? kept
  return from || page
    ? came(
      from?.at ?? Date.now(),
      from?.said ?? {},
      page,
      from?.app,
      from?.invite,
    )
    : null
}

let valued = (came: Came) =>
  String(
    new URLSearchParams({
      ...came.said,
      at: String(came.at),
      ...came.page ? { page: came.page } : {},
      ...came.app ? { app: came.app } : {},
      ...came.invite ? { invite: came.invite } : {},
    }),
  )

// Whether an answer is a page a person opened: a GET or HEAD answered with
// HTML, or sent on (a redirect, a 304) to one.
let opened = (req: Request, res: Response) =>
  (req.method == 'GET' || req.method == 'HEAD') &&
  (res.status >= 300 && res.status < 400 ||
    res.status < 300 &&
      (res.headers.get('content-type') ?? '').startsWith('text/html'))

/**
 * The answer to a page that changes its visitor's arrival (a link with tags,
 * a home page other than the one kept), keeping that arrival; any other
 * answer as it was. Apex only: no app's host ever sees it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = 'https://yaks.app/login?utm_source=meta'
 * let page = new Response('', { headers: { 'content-type': 'text/html' } })
 * assertEquals(keep(new Request(at), page).headers.has('set-cookie'), true)
 * let json = Response.json({})
 * assertEquals(keep(new Request(at), json).headers.has('set-cookie'), false)
 * let again = { headers: { cookie: 'yak_came=at=5&page=church' } }
 * let church = new Request('https://yaks.app/churches', again)
 * assertEquals(keep(church, page).headers.has('set-cookie'), false)
 * ```
 */
export let keep = (req: Request, res: Response): Response => {
  let came = opened(req, res) && arrival(req)
  if (!came) return res
  let value = valued(came)
  if (value == cookieValue(req.headers.get('cookie'), COOKIE)) return res
  let out = new Response(res.body, res)
  out.headers.append(
    'set-cookie',
    `${COOKIE}=${value}; Max-Age=${DAYS * 86400}; Path=/; Secure; HttpOnly; ` +
      'SameSite=Lax',
  )
  return out
}

/**
 * The campaign the funnel counts an arrival under: its source, medium and
 * campaign tags, as `source/medium/campaign`, or '' with none of them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let said = { utm_source: 'meta', utm_campaign: 'pilot', fbclid: 'Ab1' }
 * assertEquals(campaign({ at: 1, said }), 'meta//pilot')
 * assertEquals(campaign({ at: 1, said: { fbclid: 'Ab1' } }), '')
 * assertEquals(campaign(null), '')
 * ```
 */
export let campaign = (came: Came | null) => {
  let s = came?.said ?? {}
  let parts = [s.utm_source, s.utm_medium, s.utm_campaign]
  return parts.some(Boolean) ? parts.map((p) => p ?? '').join('/') : ''
}

/** Whether an arrival carries any ad network's click id. */
export let clicked = (came: Came | null) =>
  Object.keys(came?.said ?? {}).some((k) => CLICK.test(k))

/** What a step of a visit tells an ad network (conversions.ts): a page seen,
 * or a person signing up. */
export type Told = 'view' | 'signup'

/** One thing a visit did, as an ad network is told it: what it was, the page,
 * when, the browser's address and user agent, and the arrival. */
export type Conversion = {
  told: Told
  id: string
  url: string
  at: number
  ip: string
  agent: string
  came: Came
}

/**
 * What this request tells an ad network, or null when no ad network's click
 * brought it or no person sent it: a visit nobody's ad sent is told to nobody,
 * and nor is a crawler following an ad's link (@yaks/platform/visitor), the network's
 * own among them.
 */
export let conversionOf = (
  told: Told,
  req: Request,
  now = Date.now(),
): Conversion | null => {
  let came = isPerson(req) ? arrival(req) : null
  if (!came || !clicked(came)) return null
  let url = new URL(req.url)
  return {
    told,
    id: crypto.randomUUID(),
    url: `${url.origin}${url.pathname}`,
    at: now,
    ip: req.headers.get('cf-connecting-ip') ?? '',
    agent: req.headers.get('user-agent') ?? '',
    came,
  }
}

/** The way somebody came in when they signed up: the home page's box, the
 * sign-in page, an assistant's connector, an invitation's link, or a letter
 * or a text to the platform. */
export type Door =
  | 'box'
  | 'login'
  | 'connector'
  | 'invitation'
  | 'email'
  | 'text'

/** Where a person came from when they signed up, as the directory keeps it
 * (`arrived`), from the door, the arrival their browser carried, if any, and
 * the assistant or inviter the door names. */
export type Arrived = {
  at: string
  door: Door
  page?: string
  campaign?: string
  said?: Record<string, string>
  app?: string
  assistant?: string
  inviter?: string
}

/**
 * The `arrived` a sign-up through `door` keeps, at `now`: what its arrival
 * says, and whoever else brought them. Nothing it does not know is written.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = '2026-11-19T00:00:00.000Z'
 * let came = { at: 5, said: { utm_source: 'meta', fbclid: 'Ab1' }, page: 'church' }
 * assertEquals(arrivedOf(came, 'login', { now: at }), {
 *   at,
 *   door: 'login',
 *   page: 'church',
 *   campaign: 'meta//',
 *   said: { utm_source: 'meta', fbclid: 'Ab1' },
 * })
 * assertEquals(arrivedOf(null, 'connector', { now: at, assistant: 'Claude' }), {
 *   at,
 *   door: 'connector',
 *   assistant: 'Claude',
 * })
 * ```
 */
export let arrivedOf = (
  came: Came | null,
  door: Door,
  { now = new Date().toISOString(), assistant, inviter }: {
    now?: string
    assistant?: string
    inviter?: string
  } = {},
): Arrived => {
  let said = came?.said ?? {}, named = campaign(came)
  return {
    at: now,
    door,
    ...came?.page ? { page: came.page } : {},
    ...named ? { campaign: named } : {},
    ...Object.keys(said).length ? { said } : {},
    ...came?.app ? { app: came.app } : {},
    ...assistant ? { assistant: assistant.slice(0, CAP) } : {},
    ...inviter ? { inviter } : {},
  }
}
