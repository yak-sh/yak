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
//
// READING it back is the other half (T-34497): the SQL API, which is a POST of
// SQL text to the account's own endpoint carrying an Account Analytics Read
// token — a SECRET the owner mints (README.md's settings table has the steps),
// never a binding, because there is no read binding for a dataset. Unset, the
// space page says analytics are not switched on yet and nothing errors.
//
// Every count in this file is `sum(_sample_interval)` and never `count()`.
// Analytics Engine SAMPLES under load: it keeps one row and records how many
// that row stands for, so a plain `count()` under-reports a busy app by
// exactly the factor that made it busy, and nothing would say so.
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

// ---- reading it back (T-34497) ---------------------------------------------

/** The dataset the queries below read. wrangler.toml binds it as VIEWS. */
export let DATASET = 'yak_views'

/**
 * The window a creator is shown, and the longest one they may ask for — past
 * KEPT_DAYS there is nothing to read, so asking for more is a slower way to
 * see the same thing.
 */
export let DAYS = 30

/**
 * How many rows a "top" list is. Enough to see the shape, short enough to read
 * on a phone.
 */
export let TOP = 10

/**
 * How long an answer is held before the SQL API is asked again. Views are a
 * curiosity, not a control: a few minutes stale is invisible to a person, and
 * it saves a round trip on every refresh of the page.
 */
export let FRESH = 5 * 60_000

/** Cloudflare's API, and the one endpoint on it that answers SQL. The account
 * is CF_ACCOUNT, which is not a secret; ANALYTICS_API is a probe's door to
 * somewhere other than Cloudflare, the way MAIL_API and STRIPE_API are. */
export let API = 'https://api.cloudflare.com/client/v4'

export let sqlAt = (env: Env) =>
  `${env.ANALYTICS_API ?? API}/accounts/${env.CF_ACCOUNT}/analytics_engine/sql`

// There are no bound parameters in the SQL API — a query is a string of text —
// so the SHAPES are the guard. An eid comes out of our own directory and a day
// count off a tool argument, and neither is spliced in on trust.
let eid = (app: string) => {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(app)) {
    throw new Error(`not an app: ${app}`)
  }
  return app
}

let whole = (n: number, most: number) =>
  Math.max(1, Math.min(most, Math.floor(n) || 1))

/** What a count is, everywhere here: sampled rows, each standing for many. */
export let COUNT = 'sum(_sample_interval)'

// One app, one window — the FROM and WHERE every query below shares.
let over = (app: string, days: number) =>
  `FROM ${DATASET} WHERE index1 = '${eid(app)}' ` +
  `AND timestamp >= NOW() - INTERVAL '${whole(days, KEPT_DAYS)}' DAY`

/**
 * Views per day, oldest first: the bars. A day nobody came is absent from the
 * answer and filled in by `daily` below, because a gap in a chart is a quiet
 * day and not a missing one.
 */
export let perDay = (app: string, days = DAYS) =>
  `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ` +
  `${COUNT} AS views ${over(app, days)} GROUP BY day ORDER BY day`

// The three "top" lists are one query with a different column, so they are one
// function. `skip` drops the rows that never had the fact: a direct visit has
// no referring site, and an unknown country is not a country.
let top =
  (col: string, as: string, skip: boolean) =>
  (app: string, days = DAYS, limit = TOP) =>
    `SELECT ${col} AS ${as}, ${COUNT} AS views ${over(app, days)}` +
    `${skip ? ` AND ${col} != ''` : ''} ` +
    `GROUP BY ${as} ORDER BY views DESC LIMIT ${whole(limit, 100)}`

/** The most-visited pages. Every view has a path, so none is skipped. */
export let topPages = top(PATH, 'path', false)

/** The sites that linked here. A direct visit refers nothing and is left out. */
export let topFrom = top(FROM, 'site', true)

/** Where the visitors were. An unknown country is left out. */
export let topCountries = top(COUNTRY, 'country', true)

/** Browser, bot or agent, and how many of each. */
export let byClient = top(CLIENT, 'client', true)

// The SQL API's default format, which is what these queries get back: the
// schema, the rows, and the count. A number wider than a double arrives as a
// STRING, which is why every number here goes through `num`.
type Answer = { data?: Record<string, unknown>[] }

let num = (v: unknown) => Number(v) || 0
let str = (v: unknown) => (v == null ? '' : String(v))

/**
 * One query, run. The API takes SQL as the request body and answers JSON. A
 * dataset nobody has written to yet does not exist, and that is an app with no
 * views rather than a failure, so a 404 is an empty answer.
 */
export let ran = async (
  env: Env,
  sql: string,
): Promise<Record<string, unknown>[]> => {
  let res = await globalThis.fetch(sqlAt(env), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.ANALYTICS_TOKEN}` },
    body: sql,
  })
  let said = await res.text()
  if (res.status == 404) return []
  if (!res.ok) throw new Error(`analytics ${res.status}: ${said.slice(0, 200)}`)
  return (JSON.parse(said) as Answer).data ?? []
}

/** A day and what it held. */
export type Day = { day: string; views: number }

/** One line of a top list. */
export type Line = { name: string; views: number }

/** What an app's people are shown. */
export type Stats = {
  days: number
  total: number
  daily: Day[]
  pages: Line[]
  from: Line[]
  countries: Line[]
}

let YMD = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * The day series, DENSE: one entry per day in the window whether or not
 * anybody came, so a chart's flat stretches are quiet days rather than gaps.
 * Cloudflare answers a DateTime (`2026-09-01 00:00:00`) and the day is its
 * date part.
 */
export let daily = (
  rows: Record<string, unknown>[],
  days: number,
  now = Date.now(),
): Day[] => {
  let had = new Map(rows.map((r) => [str(r.day).slice(0, 10), num(r.views)]))
  let out: Day[] = []
  for (let i = days - 1; i >= 0; i--) {
    let day = YMD(now - i * 86_400_000)
    out.push({ day, views: had.get(day) ?? 0 })
  }
  return out
}

let lines = (rows: Record<string, unknown>[], col: string): Line[] =>
  rows.map((r) => ({ name: str(r[col]), views: num(r.views) }))
    .filter((l) => l.name)

// A few minutes' worth of answers, per app and window, held in this isolate
// and no further — the PROMISE rather than the value, so a page refreshed
// twice in a second makes one round trip and not two. A rejection is dropped
// rather than kept: a read that failed must not be the answer for the next
// five minutes.
let held = new Map<string, { at: number; stats: Promise<Stats> }>()

/**
 * Who visited this app, in one answer — or `null` where nobody has set
 * ANALYTICS_TOKEN, which is the platform saying analytics are not switched on
 * rather than an error every caller has to handle.
 */
export let statsOf = (
  env: Env,
  app: string,
  days = DAYS,
  now = Date.now(),
): Promise<Stats> | null => {
  if (!env.ANALYTICS_TOKEN || !env.CF_ACCOUNT) return null
  let window = whole(days, KEPT_DAYS)
  let key = `${app}:${window}`
  let fresh = held.get(key)
  if (fresh && now - fresh.at < FRESH) return fresh.stats
  let stats = asked(env, app, window, now)
  held.set(key, { at: now, stats })
  stats.catch(() => held.delete(key))
  return stats
}

let asked = async (
  env: Env,
  app: string,
  days: number,
  now: number,
): Promise<Stats> => {
  // Four questions, four queries, one round trip's worth of waiting.
  let [day, pages, from, countries] = await Promise.all([
    ran(env, perDay(app, days)),
    ran(env, topPages(app, days)),
    ran(env, topFrom(app, days)),
    ran(env, topCountries(app, days)),
  ])
  let series = daily(day, days, now)
  return {
    days,
    total: series.reduce((n, d) => n + d.views, 0),
    daily: series,
    pages: lines(pages, 'path'),
    from: lines(from, 'site'),
    countries: lines(countries, 'country'),
  }
}

/**
 * What the page and the tool both say when the token is not set. Said once,
 * here, so the two doors cannot say different things.
 */
export let NOT_ON =
  'Visitor counts are not switched on for this platform yet, so there is ' +
  'nothing to show.'
