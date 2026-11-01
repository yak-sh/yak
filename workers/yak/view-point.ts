// One page view as Analytics Engine keeps it: what views.ts counts and reads
// back, and what yak-front (front/) writes for a page it answers from the edge.
// Nothing here imports past this file, so the front Worker can hold it.

// A blob is capped rather than trusted: a path is whatever the visitor typed,
// and 16 KB is the budget for all six of them together.
let CAP = 512

let clipped = (s: string) => (s.length > CAP ? s.slice(0, CAP) : s)

// The AI assistants and the answer engines, which are neither a person's
// browser nor an old-fashioned crawler. Tested first, because most of them
// spell themselves `…Bot` and would otherwise land in the line below.
let AGENTS =
  /claude|anthropic|gptbot|chatgpt|openai|oai-search|perplexity|gemini|google-extended|cohere|bytespider|amazonbot|meta-externalagent|applebot-extended|ccbot|duckassist|youbot/i

// Crawlers, monitors, link unfurlers and anything speaking through a library.
let BOTS =
  /bot|spider|crawler|crawl|slurp|curl|wget|python-requests|go-http-client|okhttp|libwww|httpclient|monitor|uptime|headlesschrome|phantomjs|scrapy|feedfetcher|preview|facebookexternalhit|embedly|pingdom/i

/**
 * What kind of client asked, in one word — the only thing kept out of a
 * user-agent string. An absent UA is a script rather than a person: every
 * browser sends one.
 */
export let classed = (ua: string | null | undefined): string =>
  !ua ? 'bot' : AGENTS.test(ua) ? 'agent' : BOTS.test(ua) ? 'bot' : 'browser'

/**
 * The site that linked the visitor here, as a host and nothing more — no path,
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

/** A request as the runtime hands it over, with Cloudflare's own facts on it. */
export type Visited = Request & { cf?: { country?: string } }

/** Whether an answer is a page view: an HTML page answered 200. */
export let isView = (res: Response) =>
  res.status == 200 &&
  (res.headers.get('content-type') ?? '').startsWith('text/html')

/** The data point one view of this page is written as. */
export let pointOf = (
  req: Visited,
  res: Response,
  at: { app: string; space: string; slug: string },
) => {
  let url = new URL(req.url)
  return point({
    ...at,
    path: url.pathname,
    country: req.cf?.country ?? '',
    from: referred(req.headers.get('referer'), url.host),
    client: classed(req.headers.get('user-agent')),
    status: res.status,
  })
}
