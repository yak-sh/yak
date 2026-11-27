// Who visited an app (T-34496, T-34495). One data point per HTML page the
// platform answered, written to Workers Analytics Engine — an aggregate
// column store, not a log — and read back out of it by the SQL API for the
// app's own members. The app door counts served pages with `viewed` and
// answers `/stats` with `stats`; the connector offers `app_stats`.
//
// What a data point carries is the whole privacy rule, and it is short on
// purpose: the app it was a page of, the space and app it was served under,
// the path, the visitor's country, the site that linked them here, and one
// word for what kind of client asked (@yaks/platform/visitor): a request's,
// as the page is answered, and `person` once more where the page ran in a
// browser (`pageRan`). Never the IP, never a visitor id
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
import { api } from '@yaks/cloudflare/analytics'
import { analytics, interval } from '@yaks/sql/analytics'
import {
  among,
  and,
  as,
  col,
  desc,
  type Expr,
  fn,
  ge,
  lit,
  ne,
  op,
  type Select,
  select,
  table,
} from '@yaks/sql/core'
import type { Answer } from './apps.ts'
import { background, caught } from './defects.ts'
import { elapsed } from './lib/hops.ts'
import { failure, resent } from '@yaks/cloudflare/api'
import { FUNNEL, isView, pointOf, ranOf, type Visited } from './view-point.ts'
import {
  all,
  isPerson,
  kindOf,
  people,
  requests,
  type Split,
  split,
} from '@yaks/platform/visitor'
import type { Tallied } from '@yaks/platform/admin-visits'
import { appTag, type Seen } from '@yaks/platform/kept'
import { countRows, dayRows, NOT_ON } from '@yaks/platform/visit-counts'
import type { Bundle } from '@yaks/graph'
import { type Space, storeName } from './directory.ts'
export { classed } from '@yaks/platform/visitor'
export { point, referred, type View } from './view-point.ts'

/** How long Cloudflare keeps a data point. Said in one place. */
export let KEPT_DAYS = 90

// Where the blobs land, so a query says `blob3` and a reader can see why.
export let SPACE = 'blob1'
export let SLUG = 'blob2'
export let PATH = 'blob3'
export let COUNTRY = 'blob4'
export let FROM = 'blob5'
export let CLIENT = 'blob6'
export let CAMPAIGN = 'blob7'
export let BUTTON = 'blob8'
export let VARIANT = 'blob9'

/** One page view's identity: which app it was a page of, and the address it
 * was served under. The eid is the data point's one index, so every query
 * groups by the app and a rename never loses a day of history. Beside it the
 * app's store, which a page's scripts ask next (used.ts `wake`); a data point
 * never carries it. */
export let seen = (
  space: Pick<Space, 'slug' | 'store'>,
  app: { eid: string; slug: string; store?: string | null },
): Seen => ({
  app: app.eid,
  space: space.slug,
  handle: space.store,
  slug: app.slug,
  store: storeName(space, app),
})

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
  if (!isView(res)) return
  try {
    env.VIEWS.writeDataPoint(pointOf(req as Visited, res, at))
  } catch (e) {
    caught(e, { request: 'views write', space: at.space, app: at.slug })
  }
}

/**
 * A page of an app saying it ran (public/seen.js): one person's visit, counted
 * beside the request `viewed` counted, where a browser posted it. Whatever
 * else posts is answered alike and counts nothing.
 */
export let pageRan = async (
  env: Env,
  req: Request,
  at: { app: string; space: string; slug: string },
): Promise<Response> => {
  let said = await req.text().then((t) => JSON.parse(t.slice(0, 4096)))
    .catch(() => null)
  if (env.VIEWS && said && typeof said == 'object' && isPerson(req)) {
    try {
      env.VIEWS.writeDataPoint(ranOf(req as Visited, said, at))
    } catch (e) {
      caught(e, { request: 'views ran', space: at.space, app: at.slug })
    }
  }
  return new Response(null, { status: 204 })
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
 * How many apps one query names. The SQL API refuses SQL longer than 10000
 * characters, and each app is 40 of them (`'<eid>', `), so a platform's every
 * app is asked about this many at a time, the batches side by side.
 */
export let APPS = 200

// Each batch of APPS apps asked by `ask`, at once, the answers one map.
let batched = async <T>(
  apps: string[],
  ask: (apps: string[]) => Promise<Map<string, T>>,
): Promise<Map<string, T>> => {
  let batches = []
  for (let i = 0; i < apps.length; i += APPS) {
    batches.push(apps.slice(i, i + APPS))
  }
  let all = await Promise.all(batches.map(ask))
  return new Map(all.flatMap((m) => [...m]))
}

/**
 * How long an answer is held before the SQL API is asked again. Views are a
 * curiosity, not a control: a few minutes stale is invisible to a person, and
 * it saves a round trip on every refresh of the page.
 */
export let FRESH = 5 * 60_000

/** The one endpoint on the analytics API (@yaks/cloudflare/analytics) that answers SQL. The
 * account is CF_ACCOUNT, which is not a secret. */
export let sqlAt = (env: Env) =>
  `${api(env)}/accounts/${env.CF_ACCOUNT}/analytics_engine/sql`

// An app is an eid, and one in a cache key's path is checked as one, so a key
// names an app or nothing.
let eid = (app: string) => {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(app)) {
    throw new Error(`not an app: ${app}`)
  }
  return app
}

export let whole = (n: number, most: number) =>
  Math.max(1, Math.min(most, Math.floor(n) || 1))

/** What a count is, everywhere here: sampled rows, each standing for many. */
export let COUNT = fn('sum', col('_sample_interval'))

let APP = col('index1')
let TIMESTAMP = col('timestamp')

// Some apps, one window — the source and where every query below shares. A
// query asks about every app a page shows and groups by the app, because the
// page waits on its slowest round trip: four queries an app had a space of ten
// apps' visits tab waiting 10 to 11 s live, and the same forty took the SQL
// API 5 to 20 s from the box, where these four take half a second (T-132744).
// The SQL API binds no parameters, so each eid is written as a literal by
// @yaks/sql/analytics, which refuses one that could end it.
let over = (
  apps: string[],
  days: number,
  dataset: string,
  ...more: Expr[]
) => ({
  from: table(dataset),
  where: and(among(APP, apps.map(lit)), since(days), ...more),
})

let since = (days: number) =>
  ge(TIMESTAMP, op('-', fn('NOW'), interval(whole(days, KEPT_DAYS), 'DAY')))

let DAY = as(fn('toStartOfInterval', TIMESTAMP, interval(1, 'DAY')), 'day')

let CLIENT_COL = col(CLIENT)

/** What kind of visit a data point is, for counting
 * (@yaks/platform/visitor `kindOf`). */
let KIND = as(kindOf(CLIENT_COL, TIMESTAMP), 'kind')

/** The data points a list counts: every visit where bots are shown, else
 * people's alone. */
let counting = (bots: boolean) =>
  bots ? requests(CLIENT_COL) : people(CLIENT_COL, TIMESTAMP)

/**
 * Views per app per day by kind of visit, oldest first: the bars, and how
 * many were people's and bots'. A day nobody came is absent from the answer
 * and filled in by `daily` below, because a gap in a chart is a quiet day and
 * not a missing one.
 */
export let perDay = (apps: string[], days = DAYS, dataset = DATASET) =>
  select({
    cols: [as(APP, 'app'), DAY, KIND, as(COUNT, 'views')],
    ...over(apps, days, dataset),
    group: [col('app'), col('day'), col('kind')],
    order: [col('day')],
  })

/** Each app's views by people over the window, one row an app that had
 * any. */
export let totals = (apps: string[], days = DAYS, dataset = DATASET) =>
  select({
    cols: [as(APP, 'app'), as(COUNT, 'views')],
    ...over(apps, days, dataset, counting(false)),
    group: [col('app')],
  })

// The three "top" lists are one query with a different column, so they are one
// function. `skip` drops the rows that never had the fact: a direct visit has
// no referring site, and an unknown country is not a country.
let top = (blob: string, name: string, skip: boolean) =>
(
  apps: string[],
  days = DAYS,
  limit = TOP,
  dataset = DATASET,
  bots = false,
) =>
  select({
    cols: [as(APP, 'app'), as(col(blob), name), as(COUNT, 'views')],
    ...over(
      apps,
      days,
      dataset,
      counting(bots),
      ...skip ? [ne(col(blob), lit(''))] : [],
    ),
    group: [col('app'), col(name)],
    order: [desc(col('views'))],
    limit: lit(whole(limit, ROWS)),
  })

/** The most-visited pages. Every view has a path, so none is skipped. */
export let topPages = top(PATH, 'path', false)

/** The sites that linked here. A direct visit refers nothing and is left out. */
export let topFrom = top(FROM, 'site', true)

/** Where the visitors were. An unknown country is left out. */
export let topCountries = top(COUNTRY, 'country', true)

// ---- every app at once (T-4011) --------------------------------------------

// Every app's views, the platform's own funnel steps left out
// (view-point.ts `FUNNEL`): those are steps, not pages of an app.
let everyApp = (days: number, dataset: string) => ({
  from: table(dataset),
  where: and(ne(APP, lit(FUNNEL)), since(days)),
})

/** How many rows a platform-wide answer may hold: a day, a space and a kind
 * of client a row, or an app and a kind of client. */
export let PLATFORM_ROWS = 10_000

/** Every app's views by day, the space they were served under and the kind
 * of visit (@yaks/platform/visitor `kindOf`): the platform's chart, test
 * spaces told apart by their slug. */
export let platformDays = (days = DAYS, dataset = DATASET) =>
  select({
    cols: [DAY, as(col(SPACE), 'space'), KIND, as(COUNT, 'views')],
    ...everyApp(days, dataset),
    group: [col('day'), col('space'), col('kind')],
    order: [col('day')],
    limit: lit(PLATFORM_ROWS),
  })

/** Every app's views over the window by the kind of visit, busiest first:
 * the platform's top spaces and apps. */
export let platformApps = (days = DAYS, dataset = DATASET) =>
  select({
    cols: [as(APP, 'app'), KIND, as(COUNT, 'views')],
    ...everyApp(days, dataset),
    group: [col('app'), col('kind')],
    order: [desc(col('views'))],
    limit: lit(PLATFORM_ROWS),
  })

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
 * reads, so one Cloudflare fails on its own side is sent again
 * (@yaks/cloudflare/api `resent`), and one that stalls is asked again past HEDGE (`hedged`), so
 * neither holds up a page.
 */
export let ran = (env: Env, query: Select): Promise<Rows> => {
  let sql = analytics(query)
  return elapsed('analytics_wait', () => hedged(() => asking(env, sql), HEDGE))
}

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
 * `ask`, and once more if it has not answered in `wait` ms (`second`, where
 * the second asking is another way to the same answer): whichever answer
 * comes first is the answer. A failure before the second asking is the
 * answer at once; one after it waits on the second.
 */
export let hedged = <T>(
  ask: () => Promise<T>,
  wait: number,
  after: After = timeout,
  second: () => Promise<T> = ask,
): Promise<T> =>
  new Promise((resolve, reject) => {
    let again: Promise<T> | undefined
    let cancel = after(wait, () => {
      again = second()
      again.then(resolve, () => {})
    })
    ask().then(resolve, (e) => again ? again.then(resolve, reject) : reject(e))
      .finally(cancel)
  })

/** A day and what it held. */
export type Day = { day: string; views: number }

/** One line of a top list. */
export type Line = { name: string; views: number }

/** What an app's people are shown, and when it was counted: people's visits
 * alone, or every visit where `bots`, and the split of the window's visits
 * either way (@yaks/platform/visitor). */
export type Stats = {
  at: string
  days: number
  bots: boolean
  total: number
  split: Split
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
 * date part; a day's rows, one a kind of visit, are split
 * (@yaks/platform/visitor `split`) and counted as people's, or every visit
 * where `bots`.
 */
export let daily = (
  rows: Rows,
  days: number,
  now = Date.now(),
  bots = false,
): Day[] => {
  let kinds = new Map<string, Record<string, number>>()
  for (let r of rows) {
    let day = word(r.day).slice(0, 10)
    let of = kinds.get(day) ?? {}
    let kind = word(r.kind)
    of[kind] = (of[kind] ?? 0) + num(r.views)
    kinds.set(day, of)
  }
  let had = new Map(
    [...kinds].map(([day, of]) => {
      let s = split(of)
      return [day, bots ? all(s) : s.people]
    }),
  )
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
  bots: boolean,
) => {
  let limit = apps.length > 1 ? ROWS : TOP
  let rows = await ran(env, query(apps, days, limit, dataset, bots))
  let each = new Map(
    [...byApp(rows, apps)].map(([app, rows]) => [app, lines(rows, col)]),
  )
  await Promise.all(
    cut(rows, limit, each).map(async (app) => {
      each.set(
        app,
        lines(await ran(env, query([app], days, TOP, dataset, bots)), col),
      )
    }),
  )
  return each
}

// Each analytics read belongs to the request that started it. Keep it alive
// to fill the cache if the page answers first. Only its data can be reused.
let remember = <T>(read: Promise<T>, keep: (answer: T) => void): Promise<T> => {
  let result = read.then((answer) => {
    keep(answer)
    return answer
  })
  background(result.then(() => {}, () => {}))
  return result
}

let held = new Map<string, { at: number; stats: Stats }>()

/**
 * Who visited these apps, one answer an app — or `null` where nobody has set
 * CF_ANALYTICS_TOKEN, which is the platform saying analytics are not switched
 * on rather than an error every caller has to handle. People's visits alone,
 * or every visit where `bots`. Only the apps with no answer held are asked
 * about, all of them in the same four queries.
 */
export let statsFor = (
  env: Env,
  apps: string[],
  days = DAYS,
  now = Date.now(),
  bots = false,
): Promise<Map<string, Stats>> | null => {
  if (!statsOn(env)) return null
  let window = whole(days, KEPT_DAYS)
  let key = (app: string) =>
    `${sqlAt(env)}:${env.VIEWS_DATASET ?? DATASET}:${app}:${window}:${bots}`
  let fresh = (app: string) => {
    let kept = held.get(key(app))
    return kept && now - kept.at < FRESH ? kept.stats : undefined
  }
  let found = new Map<string, Stats>()
  let missing: string[] = []
  for (let app of new Set(apps)) {
    let kept = fresh(app)
    if (kept) found.set(app, kept)
    else missing.push(app)
  }
  let inOrder = () => new Map(apps.map((app) => [app, found.get(app)!]))
  if (!missing.length) return Promise.resolve(inOrder())
  return remember(asked(env, missing, window, now, bots), (answer) => {
    for (let [app, stats] of answer) {
      let id = key(app)
      if ((held.get(id)?.at ?? -Infinity) <= now) {
        held.set(id, { at: now, stats })
      }
      found.set(app, stats)
    }
  }).then(inOrder)
}

/**
 * Every app's views by people over the last `days` ({@link DAYS} by
 * default), one query a batch of {@link APPS}, for the hourly reading to keep
 * on each row (usage.ts): an app absent from the answer had none.
 */
export let visited = (
  env: Env,
  apps: string[],
  days = DAYS,
): Promise<Map<string, number>> =>
  batched(apps, async (apps) => {
    let rows = await ran(env, totals(apps, days, env.VIEWS_DATASET ?? DATASET))
    return new Map(rows.map((r) => [word(r.app), num(r.views)]))
  })

// The last day's answers, by the apps asked about, held like `held`.
let lastDays = new Map<
  string,
  { at: number; views: Map<string, number> }
>()

/** Each app's views by people over the last day, for a space's Updates
 * (updates.ts),
 * held for {@link FRESH}; `null` where analytics are not switched on. */
export let lastDay = (
  env: Env,
  apps: string[],
  now = Date.now(),
): Promise<Map<string, number>> | null => {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT) return null
  let key = `${sqlAt(env)}:${env.VIEWS_DATASET ?? DATASET}:${
    [...apps].sort().join(',')
  }`
  let kept = lastDays.get(key)
  if (kept && now - kept.at < FRESH) return Promise.resolve(kept.views)
  return remember(visited(env, apps, 1), (views) => {
    if ((lastDays.get(key)?.at ?? -Infinity) <= now) {
      lastDays.set(key, { at: now, views })
    }
  })
}

// ---- one app's answer, kept at the edge (T-143071) -------------------------

// The SQL API answers in 0.2 s at best, so an answer held in one isolate left
// every other isolate, and every one past FRESH, waiting on it. One app's
// answer is kept in Site's cache instead (site.ts), as its pages are: fresh
// for FRESH, then answered at once while Site counts again behind the asker,
// for a day. An answer that old says when it was counted (`ago`). Only
// an app's people are told it (the doors below ask first), and Site is
// reachable only through the gateway's binding; the key is the app's eid.
//
// A kept answer comes back in a few ms. One Site has not kept yet is counted
// in a colo of the cache's choosing and costs twice the SQL API's time, so
// past HIT it is counted here as well, and Site's counting goes on behind the
// answer to keep it for the next asker.

/** Longer than Site takes to answer what it keeps. */
export let HIT = 60

/** Where Site keeps one app's answer. */
export let COUNTED = '/stats/'

/** The key Site keeps an app's answer over `days` under, people's or every
 * visit (`bots`). */
export let statsAt = (app: string, days = DAYS, bots = false) =>
  `https://site.invalid${COUNTED}${eid(app)}/${whole(days, KEPT_DAYS)}${
    bots ? '/bots' : ''
  }`

/** How long Site keeps an answer fresh, and then stale while it counts. */
export let KEEP = `public, max-age=${FRESH / 1000}, ` +
  'stale-while-revalidate=86400'

/** Where Site keeps the platform's answer over `days` ({@link tallied}),
 * beside each app's. */
export let PLATFORM = 'platform'

/** The key Site keeps the platform's answer over `days` under. */
export let platformAt = (days = DAYS) =>
  `https://site.invalid${COUNTED}${PLATFORM}/${whole(days, KEPT_DAYS)}`

/** Site's half: the answer at a {@link statsAt} key, kept with its app's tag
 * so the app's erasure purges it, or at {@link platformAt}. A failure is never
 * kept. */
export let counted = async (env: Env, path: string): Promise<Response> => {
  let [app, days, bots] = path.slice(COUNTED.length).split('/')
  let unkept = (status: number, said: string) =>
    new Response(said, {
      status,
      headers: { 'cache-control': 'private, no-store' },
    })
  if (!statsOn(env)) return unkept(404, NOT_ON)
  try {
    let window = whole(Number(days), KEPT_DAYS)
    if (app == PLATFORM) {
      return Response.json(await tallied(env, window), {
        headers: { 'cache-control': KEEP },
      })
    }
    let answer = await asked(env, [eid(app)], window, Date.now(), !!bots)
    return Response.json(answer.get(app), {
      headers: { 'cache-control': KEEP, 'cache-tag': appTag(app) },
    })
  } catch (e) {
    return unkept(502, e instanceof Error ? e.message : String(e))
  }
}

let statsOn = (env: Env) => !!env.CF_ANALYTICS_TOKEN && !!env.CF_ACCOUNT

/** Who visited one app, people or everyone (`bots`): Site's kept answer
 * where Site is bound, else {@link statsFor} asked about it alone. */
export let statsOf = (
  env: Env,
  app: string,
  days = DAYS,
  now = Date.now(),
  bots = false,
): Promise<Stats> | null =>
  statsOn(env)
    ? kept(
      env,
      statsAt(app, days, bots),
      () =>
        statsFor(env, [app], days, now, bots)!.then((each) => each.get(app)!),
      { app },
    )
    : null

/** Every app's views over the last `days`, as Cloudflare's analytics answer
 * them across the platform at once: by day, space and kind of client, and by
 * app and kind of client. The admin's Visits page tells them apart
 * (@yaks/platform/admin-visits). */
export let tallied = async (
  env: Env,
  days = DAYS,
  now = Date.now(),
): Promise<Tallied> => {
  let dataset = env.VIEWS_DATASET ?? DATASET
  let [daily, apps] = await Promise.all([
    ran(env, platformDays(days, dataset)),
    ran(env, platformApps(days, dataset)),
  ])
  return {
    at: new Date(now).toISOString(),
    days: whole(days, KEPT_DAYS),
    daily: daily.map((r) => ({
      day: word(r.day),
      space: word(r.space),
      kind: word(r.kind),
      views: num(r.views),
    })),
    apps: apps.map((r) => ({
      app: word(r.app),
      kind: word(r.kind),
      views: num(r.views),
    })),
  }
}

/** The platform's visits: Site's kept answer where Site is bound, else
 * {@link tallied} here; null where analytics are not switched on. */
export let platformOf = (env: Env, days = DAYS): Promise<Tallied> | null =>
  statsOn(env)
    ? kept(env, platformAt(days), () => tallied(env, days), {
      app: PLATFORM,
    })
    : null

// The answer Site keeps at `key`, or `here`'s where Site is slower than HIT
// or not bound; Site's counting goes on behind to keep it for the next asker.
let kept = <T>(
  env: Env,
  key: string,
  here: () => Promise<T>,
  tags: { app: string },
): Promise<T> => {
  let site = env.SITE
  if (!site) return here()
  let held = (async () => {
    let res = await site.fetch(new Request(key))
    if (!res.ok) {
      throw failure(
        res.status,
        `analytics ${res.status}: ${(await res.text()).slice(0, 200)}`,
      )
    }
    return await res.json() as T
  })()
  background(
    held.then(() => {}, (e) => caught(e, { request: 'views keep', ...tags })),
  )
  return elapsed('analytics_wait', () => hedged(() => held, HIT, timeout, here))
}

/** How long ago an answer was counted, said once it is older than FRESH. */
export let ago = (stats: Pick<Stats, 'at'>, now = Date.now()) => {
  let minutes = Math.floor((now - Date.parse(stats.at)) / 60_000)
  if (minutes * 60_000 < FRESH) return ''
  return ` (counted ${
    minutes < 120 ? `${minutes} minutes` : `${Math.floor(minutes / 60)} hours`
  } ago)`
}

// Four questions, four queries a batch of APPS apps: one round trip's worth
// of waiting, and a second only for an app a list cut short.
let asked = (
  env: Env,
  apps: string[],
  days: number,
  now: number,
  bots: boolean,
): Promise<Map<string, Stats>> =>
  batched(apps, (apps) => askedOf(env, apps, days, now, bots))

// The window's views of one app by kind of visit, from its days' rows.
let kinds = (rows: Rows) => {
  let of: Record<string, number> = {}
  for (let r of rows) of[word(r.kind)] = (of[word(r.kind)] ?? 0) + num(r.views)
  return of
}

let askedOf = async (
  env: Env,
  apps: string[],
  days: number,
  now: number,
  bots: boolean,
): Promise<Map<string, Stats>> => {
  let dataset = env.VIEWS_DATASET ?? DATASET
  let list = (query: ReturnType<typeof top>, col: string) =>
    listed(env, query, col, apps, days, dataset, bots)
  let [day, pages, from, countries] = await Promise.all([
    ran(env, perDay(apps, days, dataset)).then((rows) => byApp(rows, apps)),
    list(topPages, 'path'),
    list(topFrom, 'site'),
    list(topCountries, 'country'),
  ])
  return new Map(apps.map((app) => {
    let series = daily(day.get(app)!, days, now, bots)
    return [app, {
      at: new Date(now).toISOString(),
      days,
      bots,
      total: series.reduce((n, d) => n + d.views, 0),
      split: split(kinds(day.get(app)!)),
      daily: series,
      pages: pages.get(app)!,
      from: from.get(app)!,
      countries: countries.get(app)!,
    }]
  }))
}

/**
 * What the page and the tool both say when the token is not set. Said once,
 * in @yaks/platform/visit-counts, so the doors cannot say different things.
 */
export { NOT_ON }

/**
 * The views of each of `apps` in the space `space`, as its Visits page holds
 * them (@yaks/platform/visit-counts): in the same four queries as
 * {@link statsFor}, or that the platform cannot say, where analytics are not
 * switched on or the read failed. A failure is reported, not thrown: the page
 * does not go down because Cloudflare's analytics did.
 */
export let visitRows = async (
  env: Env,
  space: string,
  apps: string[],
  bots = false,
): Promise<Bundle[]> => {
  if (!apps.length) return countRows(space, new Map(), bots)
  let asked = statsFor(env, apps, DAYS, Date.now(), bots)
  try {
    return countRows(space, asked && await asked, bots)
  } catch (e) {
    caught(e, { request: 'views' })
    return countRows(space, null, bots)
  }
}

/** The last day's views of each of `apps` of the space `space`, as rows
 * (@yaks/platform/visit-counts `dayRows`): none counted where the platform
 * cannot say, or its analytics did not answer. */
export let visitDayRows = async (
  env: Env,
  space: string,
  apps: string[],
): Promise<Bundle[]> => {
  if (!apps.length) return dayRows(space, new Map())
  let asked = lastDay(env, apps)
  try {
    return dayRows(space, asked && await asked)
  } catch (e) {
    caught(e, { request: 'views last day' })
    return dayRows(space, null)
  }
}

// ---- the door and tool ----------------------------------------------------

// Who visited, at the app's own address. The app's people, whatever its access
// says: a public app's pages are the world's to read and its visitor counts
// are not, so this asks for a role rather than for read access. Not switched
// on is a sentence and a 200, never a failure — the page showing it has
// nothing to do about a secret nobody set.
export let stats: Answer = async (at) => {
  if (at.path != '/stats') return null
  if (!at.who.role) return at.refuse('not_a_reader')
  let q = new URL(at.req.url).searchParams
  let days = q.get('days')
  let asked = statsOf(
    at.env,
    at.app.eid,
    days ? Number(days) : undefined,
    Date.now(),
    q.has('bots'),
  )
  if (!asked) return Response.json({ on: false, say: NOT_ON })
  try {
    return Response.json({ on: true, ...await asked })
  } catch (e) {
    caught(e, { request: 'views read' })
    return at.json(502, 'refused', e instanceof Error ? e.message : String(e))
  }
}
