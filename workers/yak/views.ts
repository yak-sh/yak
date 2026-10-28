// Who visited an app (T-34496, T-34495). One data point per HTML page the
// platform answered, written to Workers Analytics Engine — an aggregate
// column store, not a log — and read back out of it by the SQL API for the
// app's own members. The app door counts served pages with `viewed` and
// answers `/stats` with `stats`; the connector offers `app_stats`.
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
// 20 doubles per point, 16 KB of blobs, one index of at most 96 bytes — an eid
// is 36 characters, so the index is the app and the app is what every query
// groups by.
//
// The write is fire-and-forget: `writeDataPoint` returns nothing and blocks
// nothing, so no `ctx.waitUntil` is needed, and a throw here would take a page
// down over a counter. A failure is one log line.
//
// Reading it back is the other half (T-34497): the SQL API, which is a POST of
// SQL text to the account's own endpoint carrying an Account Analytics Read
// token shared with usage.ts, because both APIs need Account Analytics Read.
// There is no read binding for a dataset. Unset, the
// space page says analytics are not switched on yet and nothing errors.
//
// Every count in this file is `sum(_sample_interval)` and never `count()`.
// Analytics Engine samples under load: it keeps one row and records how many
// that row stands for, so a plain `count()` under-reports a busy app by
// exactly the factor that made it busy, and nothing would say so.
import type { Env } from './env.ts'
import { api } from './analytics.ts'
import type { Answer } from './apps.ts'
import { APP, inApp, type Row, SPACE as SPACE_ARG, worded } from './tool.ts'
import { url as appUrl } from './directory.ts'
import { caught } from './defects.ts'
import { elapsed } from './lib/hops.ts'
import { failure, resent } from './workers_api.ts'

/** How long Cloudflare keeps a data point. Said in one place. */
export let KEPT_DAYS = 90

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

// Where the blobs land, so a query says `blob3` and a reader can see why.
export let SPACE = 'blob1'
export let SLUG = 'blob2'
export let PATH = 'blob3'
export let COUNTRY = 'blob4'
export let FROM = 'blob5'
export let CLIENT = 'blob6'

/** One page view's identity: which app it was a page of, and the address it
 * was served under. The eid is the data point's one index, so every query
 * groups by the app and a rename never loses a day of history. */
export let seen = (
  space: { slug: string },
  app: { eid: string; slug: string },
) => ({ app: app.eid, space: space.slug, slug: app.slug })

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
    caught(e, { request: 'views write', space: at.space, app: at.slug })
  }
}

// ---- reading it back (T-34497) ---------------------------------------------

/** The dataset the queries below read. wrangler.toml binds it as views. */
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
 * How many rows one list may come back with when it is asked for several apps
 * at once. The SQL API has no `LIMIT … BY` and no window functions, so no
 * query can say "ten an app": it says the busiest rows across all of them, this
 * many, and an app whose own ten may lie past them is asked again alone
 * (`cut`). One app's crawler following relative links can leave thousands of
 * one-visit paths, and this is what keeps them out of the answer.
 */
export let ROWS = 1000

/**
 * How long an answer is held before the SQL API is asked again. Views are a
 * curiosity, not a control: a few minutes stale is invisible to a person, and
 * it saves a round trip on every refresh of the page.
 */
export let FRESH = 5 * 60_000

/** The one endpoint on the analytics API (analytics.ts) that answers SQL. The
 * account is CF_ACCOUNT, which is not a secret. */
export let sqlAt = (env: Env) =>
  `${api(env)}/accounts/${env.CF_ACCOUNT}/analytics_engine/sql`

// There are no bound parameters in the SQL API — a query is a string of text —
// so the shapes are the guard. An eid comes out of our own directory and a day
// count off a tool argument, and neither is spliced in on trust.
let eid = (app: string) => {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(app)) {
    throw new Error(`not an app: ${app}`)
  }
  return app
}

let whole = (n: number, most: number) =>
  Math.max(1, Math.min(most, Math.floor(n) || 1))

let table = (name: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`not a dataset: ${name}`)
  }
  return name
}

/** What a count is, everywhere here: sampled rows, each standing for many. */
export let COUNT = 'sum(_sample_interval)'

// Some apps, one window — the FROM and where every query below shares. A
// query asks about every app a page shows and groups by the app, because the
// page waits on its slowest round trip: four queries an app had a space of ten
// apps' visits tab waiting 10 to 11 s live, and the same forty took the SQL
// API 5 to 20 s from the box, where these four take half a second (T-132744).
let over = (apps: string[], days: number, dataset: string) =>
  `FROM ${table(dataset)} WHERE index1 IN (${
    apps.map((a) => `'${eid(a)}'`).join(', ')
  }) AND timestamp >= NOW() - INTERVAL '${whole(days, KEPT_DAYS)}' DAY`

/**
 * Views per app per day, oldest first: the bars. A day nobody came is absent
 * from the answer and filled in by `daily` below, because a gap in a chart is
 * a quiet day and not a missing one.
 */
export let perDay = (apps: string[], days = DAYS, dataset = DATASET) =>
  `SELECT index1 AS app, toStartOfInterval(timestamp, INTERVAL '1' DAY) AS ` +
  `day, ${COUNT} AS views ${over(apps, days, dataset)} ` +
  'GROUP BY app, day ORDER BY day'

// The three "top" lists are one query with a different column, so they are one
// function. `skip` drops the rows that never had the fact: a direct visit has
// no referring site, and an unknown country is not a country.
let top =
  (col: string, as: string, skip: boolean) =>
  (apps: string[], days = DAYS, limit = TOP, dataset = DATASET) =>
    `SELECT index1 AS app, ${col} AS ${as}, ${COUNT} AS views ${
      over(apps, days, dataset)
    }${skip ? ` AND ${col} != ''` : ''} ` +
    `GROUP BY app, ${as} ORDER BY views DESC LIMIT ${whole(limit, ROWS)}`

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
// string, which is why every number here goes through `num`.
type Rows = Record<string, unknown>[]
type Said = { data?: Rows }

let num = (v: unknown) => Number(v) || 0
let word = (v: unknown) => (v == null ? '' : String(v))

/**
 * How long a query is waited on before it is asked a second time. The SQL API
 * answers in 0.2 to 1.1 s, and a few queries in a hundred stall for 6 or 10 s
 * while the others asked beside them answer (measured from the box,
 * T-132744): the same query asked again answers in the usual time.
 */
export let HEDGE = 1500

/**
 * One query, run. The API takes SQL as the request body and answers JSON. A
 * dataset nobody has written to yet does not exist, and that is an app with no
 * views rather than a failure, so a 404 is an empty answer. A query only
 * reads, so one Cloudflare fails on its own side is sent again (workers_api.ts
 * `resent`), and one that stalls is asked again past HEDGE (`hedged`), so
 * neither holds up a page.
 */
export let ran = (env: Env, sql: string): Promise<Rows> =>
  elapsed('analytics_wait', () => hedged(() => asking(env, sql), HEDGE))

let asking = async (env: Env, sql: string): Promise<Rows> => {
  let res = await resent(sqlAt(env), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
    body: sql,
  }, { idempotent: true })
  let said = await res.text()
  if (res.status == 404) return []
  if (!res.ok) {
    throw failure(res.status, `analytics ${res.status}: ${said.slice(0, 200)}`)
  }
  return (JSON.parse(said) as Said).data ?? []
}

// A timer as @yaks/testing's `clock` hands one out: run `fn` in `ms`, and the
// way to call it off.
type After = (ms: number, fn: () => void) => () => void

let timeout: After = (ms, fn) => {
  let timer = setTimeout(fn, ms)
  return () => clearTimeout(timer)
}

/**
 * `ask`, and once more if it has not answered in `wait` ms: whichever answer
 * comes first is the answer. A failure before the second asking is the
 * answer at once; one after it waits on the second.
 */
export let hedged = <T>(
  ask: () => Promise<T>,
  wait: number,
  after: After = timeout,
): Promise<T> =>
  new Promise((resolve, reject) => {
    let again: Promise<T> | undefined
    let cancel = after(wait, () => {
      again = ask()
      again.then(resolve, () => {})
    })
    ask().then(resolve, (e) => again ? again.then(resolve, reject) : reject(e))
      .finally(cancel)
  })

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
 * The day series, dense: one entry per day in the window whether or not
 * anybody came, so a chart's flat stretches are quiet days rather than gaps.
 * Cloudflare answers a DateTime (`2026-09-01 00:00:00`) and the day is its
 * date part.
 */
export let daily = (rows: Rows, days: number, now = Date.now()): Day[] => {
  let had = new Map(rows.map((r) => [word(r.day).slice(0, 10), num(r.views)]))
  let out: Day[] = []
  for (let i = days - 1; i >= 0; i--) {
    let day = YMD(now - i * 86_400_000)
    out.push({ day, views: had.get(day) ?? 0 })
  }
  return out
}

// An answer's rows, an app at a time, in the order they came.
let byApp = (rows: Rows, apps: string[]) => {
  let out = new Map(apps.map((app) => [app, [] as Rows]))
  for (let r of rows) out.get(word(r.app))?.push(r)
  return out
}

let lines = (rows: Rows, col: string): Line[] =>
  rows.map((r) => ({ name: word(r[col]), views: num(r.views) }))
    .filter((l) => l.name).slice(0, TOP)

/**
 * The apps one list's answer may have cut short. An answer shorter than its
 * limit holds every row there is. A full one holds only rows at least as busy
 * as its last, so an app whose own TOP-th line is not that busy may have lost
 * lines past the limit.
 */
export let cut = (
  rows: Rows,
  limit: number,
  each: Map<string, Line[]>,
): string[] => {
  if (rows.length < limit) return []
  let least = num(rows[rows.length - 1].views)
  return [...each].filter(([, lines]) => (lines[TOP - 1]?.views ?? 0) < least)
    .map(([app]) => app)
}

// One list for every app, from one query: each app's busiest lines, and an
// app the answer may have cut short asked again alone, where the limit is its
// own.
let listed = async (
  env: Env,
  query: ReturnType<typeof top>,
  col: string,
  apps: string[],
  days: number,
  dataset: string,
) => {
  let limit = apps.length > 1 ? ROWS : TOP
  let rows = await ran(env, query(apps, days, limit, dataset))
  let each = new Map(
    [...byApp(rows, apps)].map(([app, rows]) => [app, lines(rows, col)]),
  )
  await Promise.all(
    cut(rows, limit, each).map(async (app) => {
      each.set(
        app,
        lines(await ran(env, query([app], days, TOP, dataset)), col),
      )
    }),
  )
  return each
}

// A few minutes' worth of answers, per app and window, held in this isolate
// and no further — the promise rather than the value, so a page refreshed
// twice in a second makes one round trip and not two. A rejection is dropped
// rather than kept: a read that failed must not be the answer for the next
// five minutes.
let held = new Map<string, { at: number; stats: Promise<Stats> }>()

/**
 * Who visited these apps, one answer an app — or `null` where nobody has set
 * CF_ANALYTICS_TOKEN, which is the platform saying analytics are not switched
 * on rather than an error every caller has to handle. Only the apps with no
 * answer held are asked about, all of them in the same four queries.
 */
export let statsFor = (
  env: Env,
  apps: string[],
  days = DAYS,
  now = Date.now(),
): Promise<Map<string, Stats>> | null => {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT) return null
  let window = whole(days, KEPT_DAYS)
  let key = (app: string) =>
    `${sqlAt(env)}:${env.VIEWS_DATASET ?? DATASET}:${app}:${window}`
  let fresh = (app: string) => {
    let kept = held.get(key(app))
    return kept && now - kept.at < FRESH ? kept.stats : undefined
  }
  let missing = [...new Set(apps)].filter((app) => !fresh(app))
  if (missing.length) {
    let all = asked(env, missing, window, now)
    for (let app of missing) {
      let stats = all.then((all) => all.get(app)!)
      held.set(key(app), { at: now, stats })
      stats.catch(() => {
        if (held.get(key(app))?.stats == stats) held.delete(key(app))
      })
    }
  }
  let each = apps.map((app) => fresh(app)!)
  return Promise.all(each).then((all) =>
    new Map(apps.map((app, i) => [app, all[i]]))
  )
}

/** Who visited one app: {@link statsFor} asked about it alone. */
export let statsOf = (
  env: Env,
  app: string,
  days = DAYS,
  now = Date.now(),
): Promise<Stats> | null =>
  statsFor(env, [app], days, now)?.then((all) => all.get(app)!) ?? null

// Four questions, four queries, whatever the number of apps: one round
// trip's worth of waiting, and a second only for an app a list cut short.
let asked = async (
  env: Env,
  apps: string[],
  days: number,
  now: number,
): Promise<Map<string, Stats>> => {
  let dataset = env.VIEWS_DATASET ?? DATASET
  let list = (query: ReturnType<typeof top>, col: string) =>
    listed(env, query, col, apps, days, dataset)
  let [day, pages, from, countries] = await Promise.all([
    ran(env, perDay(apps, days, dataset)).then((rows) => byApp(rows, apps)),
    list(topPages, 'path'),
    list(topFrom, 'site'),
    list(topCountries, 'country'),
  ])
  return new Map(apps.map((app) => {
    let series = daily(day.get(app)!, days, now)
    return [app, {
      days,
      total: series.reduce((n, d) => n + d.views, 0),
      daily: series,
      pages: pages.get(app)!,
      from: from.get(app)!,
      countries: countries.get(app)!,
    }]
  }))
}

/**
 * What the page and the tool both say when the token is not set. Said once,
 * here, so the two doors cannot say different things.
 */
export let NOT_ON =
  'Visitor counts are not switched on for this platform yet, so there is ' +
  'nothing to show.'

// ---- the door and tool ----------------------------------------------------

// Who visited, at the app's own address. The app's people, whatever its access
// says: a public app's pages are the world's to read and its visitor counts
// are not, so this asks for a role rather than for read access. Not switched
// on is a sentence and a 200, never a failure — the page showing it has
// nothing to do about a secret nobody set.
export let stats: Answer = async (at) => {
  if (at.path != '/stats') return null
  if (!at.who.role) return at.refuse('not_a_reader')
  let days = new URL(at.req.url).searchParams.get('days')
  let asked = statsOf(at.env, at.app.eid, days ? Number(days) : undefined)
  if (!asked) return Response.json({ on: false, say: NOT_ON })
  try {
    return Response.json({ on: true, ...await asked })
  } catch (e) {
    caught(e, { request: 'views read' })
    return at.json(502, 'refused', e instanceof Error ? e.message : String(e))
  }
}

// The rows, said as rows: the words each says about itself are in
// tools.yml under its name (tool.ts `worded`).
let STATS: Row[] = [
  {
    name: 'app_stats',
    readOnly: true,
    // The numbers come from Cloudflare's analytics, past yaks.app.
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE_ARG,
        app: APP,
        days: {
          type: 'number',
          description:
            'how far back, in days (default 30). Cloudflare keeps three ' +
            'months, so anything past 90 is the same answer as 90.',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app } = await inApp(ctx, args)
      let days = args.days == null ? undefined : Number(args.days)
      // No token, no numbers — one sentence rather than an error, because
      // there is nothing the agent or the person can do about it (views.ts).
      let asked = statsOf(ctx.env, app.eid, days)
      if (!asked) return { text: NOT_ON, space }
      let seen = await asked
      let list = (head: string, rows: { name: string; views: number }[]) =>
        rows.length
          ? [`${head}:`, ...rows.map((r) => `- ${r.name} — ${r.views}`)]
          : []
      let text = seen.total
        ? [
          `${space.slug}/${app.slug} — ${seen.total} ${
            seen.total == 1 ? 'visit' : 'visits'
          } in ${seen.days} ` +
          `days (${appUrl(space, app, ctx.env)})`,
          ...list('Pages', seen.pages),
          ...list('Came from', seen.from),
          ...list('Countries', seen.countries),
        ].join('\n')
        : `${space.slug}/${app.slug} — nobody has opened it in ${seen.days} ` +
          'days'
      return { text, space }
    },
  },
]

/** The connector row for reading an app's visitor counts. */
export let viewsTools = STATS.map(worded)
