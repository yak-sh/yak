// Where a visit to yaks.app came from, as the link that brought it says: its
// `utm_*` tags and an ad network's click id (a `…clid` parameter, the one an
// ad network appends to the link it sent someone along). The first page a link
// opens keeps them in a cookie of their own on the apex, so a sign-up minutes
// later still says which campaign, and which click, it came from. A link with
// neither keeps nothing, and a later link that carries them replaces them.
//
// The funnel counts its steps by the campaign (funnel.ts), and an ad network is
// told of a visit its click brought (conversions.ts). Nothing here imports past
// this file, so yak-front (front/) holds it.

/** The cookie an arrival is kept in, apart from the session's. */
export let COOKIE = 'yak_came'

/** How long an arrival is kept: an ad network's own window for a click. */
export let DAYS = 90

let TAG = /^utm_(source|medium|campaign|content|term)$/
let CLICK = /^[a-z]{1,8}clid$/

// A value is whatever the link said, so it is capped rather than trusted.
let CAP = 200

/** An arrival: the tags and click ids its link carried, and when, in ms. */
export type Came = { at: number; said: Record<string, string> }

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
 * ```
 */
export let cameFrom = (url: URL, now = Date.now()): Came | null => {
  let said: Record<string, string> = {}
  for (let [k, v] of url.searchParams) {
    if ((TAG.test(k) || CLICK.test(k)) && v) said[k] = v.slice(0, CAP)
  }
  return Object.keys(said).length ? { at: now, said } : null
}

let cookieOf = (header: string | null) => {
  for (let part of (header ?? '').split(';')) {
    let [k, ...v] = part.trim().split('=')
    if (k == COOKIE) return v.join('=')
  }
  return null
}

let read = (value: string): Came | null => {
  let q = new URLSearchParams(value), at = Number(q.get('at'))
  q.delete('at')
  let came = cameFrom(new URL(`https://x/?${q}`), at)
  return came && Number.isFinite(at) && at > 0 ? came : null
}

// What a request's own address says, read once, so the arrival it keeps and
// the one it tells of are one and the same moment.
let landed = new WeakMap<Request, Came | null>()
let landing = (req: Request) => {
  if (!landed.has(req)) landed.set(req, cameFrom(new URL(req.url)))
  return landed.get(req)!
}

/** The arrival a request carries: its own address's, else its cookie's. */
export let arrival = (req: Request): Came | null => {
  let cookie = cookieOf(req.headers.get('cookie'))
  return landing(req) ?? (cookie ? read(cookie) : null)
}

/**
 * The answer to a page an address with an arrival opened, keeping that
 * arrival; any other answer as it was. Apex only: no app's host ever sees it.
 */
export let keep = (req: Request, res: Response): Response => {
  let came = res.status < 400 && landing(req)
  if (!came) return res
  let value = new URLSearchParams({ ...came.said, at: String(came.at) })
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
 * brought it: a visit nobody's ad sent is told to nobody.
 */
export let conversionOf = (
  told: Told,
  req: Request,
  now = Date.now(),
): Conversion | null => {
  let came = arrival(req)
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
