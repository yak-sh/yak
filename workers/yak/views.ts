// Who visited an app (T-34496, T-34495). One data point per HTML page the
// platform answered, written to Workers Analytics Engine — an aggregate
// column store, not a log — and read back out of it by the SQL API for the
// app's own members.
//
// What a data point carries is the whole privacy rule, and it is short on
// purpose: the app it was a page of, the space and app it was served under,
// the path, the visitor's country, the site that linked them here, and one of
// three words for what kind of client asked. Never the IP, never a visitor id
// or a cookie, never the user-agent string itself — a UA is a fingerprint and
// a class is a word. Nothing here identifies a person, and nothing here can be
// joined back to one.
//
// Cloudflare keeps a data point for three months and no longer
// (developers.cloudflare.com/analytics/analytics-engine/limits/), which is the
// retention privacy.html promises. The other limits that bind us: 20 blobs and
// 20 doubles per point, 16 KB of blobs, ONE index of at most 96 bytes — an eid
// is 36 characters, so the index is the app and the app is what every query
// groups by.
//
// The write is fire-and-forget: `writeDataPoint` returns nothing and blocks
// nothing, so no `ctx.waitUntil` is needed, and a throw here would take a page
// down over a counter. A failure is one log line.
import type { Env } from './env.ts'

/** How long Cloudflare keeps a data point. Said in one place. */
export let KEPT_DAYS = 90

// A blob is capped rather than trusted: a path is whatever the visitor typed,
// and 16 KB is the budget for all six of them together.
let CAP = 512

let clipped = (s: string) => (s.length > CAP ? s.slice(0, CAP) : s)

// The AI assistants and the answer engines, which are neither a person's
// browser nor an old-fashioned crawler. Tested FIRST, because most of them
// spell themselves `…Bot` and would otherwise land in the line below.
let AGENTS =
  /claude|anthropic|gptbot|chatgpt|openai|oai-search|perplexity|gemini|google-extended|cohere|bytespider|amazonbot|meta-externalagent|applebot-extended|ccbot|duckassist|youbot/i

// Crawlers, monitors, link unfurlers and anything speaking through a library.
let BOTS =
  /bot|spider|crawler|crawl|slurp|curl|wget|python-requests|go-http-client|okhttp|libwww|httpclient|monitor|uptime|headlesschrome|phantomjs|scrapy|feedfetcher|preview|facebookexternalhit|embedly|pingdom/i

/**
 * What kind of client asked, in one word — the ONLY thing kept out of a
 * user-agent string. An absent UA is a script rather than a person: every
 * browser sends one.
 */
export let classed = (ua: string | null | undefined): string =>
  !ua ? 'bot' : AGENTS.test(ua) ? 'agent' : BOTS.test(ua) ? 'bot' : 'browser'

/**
 * The site that linked the visitor here, as a HOST and nothing more — no path,
 * no query, so a referrer that carried somebody's search terms carries none by
 * the time it is written down. A referral from this same hostname is not a
 * referring site at all, and is recorded as none.
 */
export let referred = (referer: string | null, host: string): string => {
  let from = referer ? tried(referer) : ''
  return from == host ? '' : from
}

let tried = (href: string) => {
  try {
    return new URL(href).host
  } catch {
    return ''
  }
}

/** One page view, in the order Analytics Engine columns are read back in. */
export type View = {
  app: string
  space: string
  slug: string
  path: string
  country: string
  from: string
  client: string
  status: number
}

/**
 * The data point a view is written as. `blobN` is positional — Cloudflare
 * gives the columns no names — so this order is the schema, and every query in
 * this file reads it back by that order. Appending is safe; reordering is not.
 */
export let point = (v: View) => ({
  indexes: [v.app],
  blobs: [v.space, v.slug, v.path, v.country, v.from, v.client].map(clipped),
  doubles: [v.status],
})

// Where the blobs land, so a query says `blob3` and a reader can see why.
export let SPACE = 'blob1'
export let SLUG = 'blob2'
export let PATH = 'blob3'
export let COUNTRY = 'blob4'
export let FROM = 'blob5'
export let CLIENT = 'blob6'

/** A request as the runtime hands it over, with Cloudflare's own facts on it. */
type Visited = Request & { cf?: { country?: string } }

/**
 * Count one page view, if it is one. Called with whatever the door is about to
 * answer: only an HTML page answered 200 is a view — a file, a redirect, a
 * refusal and every `/api/` door are not, and the platform's own pages never
 * reach here because they never come back through an app.
 */
export let viewed = (
  env: Env,
  req: Request,
  res: Response,
  at: { app: string; space: string; slug: string },
) => {
  if (!env.VIEWS) return
  if (res.status != 200) return
  if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) return
  let url = new URL(req.url)
  try {
    env.VIEWS.writeDataPoint(point({
      ...at,
      path: url.pathname,
      country: (req as Visited).cf?.country ?? '',
      from: referred(req.headers.get('referer'), url.host),
      client: classed(req.headers.get('user-agent')),
      status: res.status,
    }))
  } catch (e) {
    console.log(`views: ${(e as Error).message}`)
  }
}
