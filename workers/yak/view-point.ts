// One page view as Analytics Engine keeps it: what views.ts counts and reads
// back, and what yak-front (front/) writes for a page it answers from the edge.
// Nothing here imports past arrival.ts, crawlers.ts and variant.ts, which
// import only @yaks/platform/cookie, so the front Worker can hold it.
import { arrival, campaign } from './arrival.ts'
import { classed, isPerson, type Visited } from './crawlers.ts'
import { variant } from './variant.ts'

export type { Visited }

// A blob is capped rather than trusted: a path is whatever the visitor typed,
// and 16 KB is the budget for all six of them together.
let CAP = 512

let clipped = (s: string) => (s.length > CAP ? s.slice(0, CAP) : s)

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
    client: classed(req),
    status: res.status,
  })
}

// ---- yaks.app's own funnel (funnel.ts, D-123514) ---------------------------

/** The index yaks.app's own steps are written under. An app's index is its
 * eid, so no app's count ever reads one of these. */
export let FUNNEL = 'yaks.app'

/**
 * The data point one step of yaks.app's funnel is written as: a view of the
 * platform itself, whose slug is the step. The request, where there is one,
 * says what a view says of it, and after it the campaign its arrival names
 * (arrival.ts), the call to action clicked, for a click (funnel.ts
 * `clicked`), and the home page variant its visitor was shown (variant.ts); a
 * step taken away from any request (a person coming back) says only the step.
 * A step a test account took (@yaks/platform/bots) says `test` where a view
 * says who asked, so it is counted apart from a person's.
 */
export let stepOf = (
  step: string,
  req?: Visited,
  { button = '', test = false }: { button?: string; test?: boolean } = {},
) => {
  let url = req && new URL(req.url)
  let p = point({
    app: FUNNEL,
    space: '',
    slug: step,
    path: url?.pathname ?? '',
    country: req?.cf?.country ?? '',
    from: req && url ? referred(req.headers.get('referer'), url.host) : '',
    client: test ? 'test' : req ? classed(req) : '',
    status: 0,
  })
  p.blobs.push(
    clipped(req ? campaign(arrival(req)) : ''),
    clipped(button),
    clipped(req ? variant(req) : ''),
  )
  return p
}

/** Whether this answer at the apex is a person opening one of its pages: a
 * GET answered with a page, or a 304 for a page the browser holds, by a
 * browser rather than a crawler. */
export let isPage = (req: Request, res: Response) =>
  req.method == 'GET' && (res.status == 304 || isView(res)) &&
  isPerson(req)

/** Whether this answer at the apex is a person visiting the home page: a GET
 * of `/` that was answered, from a browser rather than a crawler. A 304 is a
 * browser coming back to a page it holds, and is a visit too. */
export let isHome = (req: Request, path: string, res: Response) =>
  path == '/' && req.method == 'GET' && res.status < 400 &&
  isPerson(req)
