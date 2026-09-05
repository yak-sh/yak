// The meter (D-32751 §Billing and metering, T-32757): what each app and each
// space spent this calendar month, read from Cloudflare's own analytics rather
// than counted in our code. Every app store is a Durable Object named
// `<space>/<app>` (directory.ts `storeName`), and the analytics group by that
// name — so the bill is already itemized by the time we ask, and no counter
// rides the hot path.
//
// The sweep is the Worker's `scheduled` handler (index.ts, wrangler.toml
// `[triggers] crons`): one GraphQL call for the month so far, one `/graph`
// read per app for the bytes it holds, and one write into the meta store —
// `meter` on each app, `meter` on each space (its apps summed), and
// `plan{free}` on a space that has none yet. The write carries the kernel
// flag, because a person never states their own bill.
//
// Two datasets, because one does not carry both numbers:
// `durableObjectsInvocationsAdaptiveGroups` has `sum.requests`,
// `durableObjectsPeriodicGroups` has `sum.rowsRead`/`sum.rowsWritten`, and
// both carry `dimensions.name`. Stored bytes are NOT from analytics:
// `durableObjectsStorageGroups` is account-wide, with no per-object dimension,
// so an app's size is what its own store reports (store.ts `/graph`).
// The datasets are documented at
// https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
// which names introspection as the way to read their fields; these field
// names came from introspecting the account's own schema.
//
// Without CF_ANALYTICS_TOKEN there is nothing to ask, so the sweep says one
// line on the log and returns: the secret is the owner's to set (T-32759), and
// a deploy standing before they do must not fail every hour.
import type { Bundle } from '@yaks/graph'
import * as dirPart from './directory.ts'
import {
  type App,
  directory,
  type Meter,
  type Space,
  stamp,
  storeName,
  type Tier,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { PRICING } from './route.ts'
import { storeOf } from './store.ts'

export let GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'

// The whole month so far, grouped by Durable Object name and nothing else:
// the fewer dimensions, the fewer rows, and one row per app is all a meter
// wants. `limit` is the group count, not the request count — a thousand apps
// still answer in one page.
export let QUERY =
  `query Meter($account: string!, $since: string!, $until: string!) {
  viewer {
    accounts(filter: {accountTag: $account}) {
      durableObjectsInvocationsAdaptiveGroups(
        limit: 10000
        filter: {datetime_geq: $since, datetime_lt: $until}
      ) {
        dimensions { name }
        sum { requests }
      }
      durableObjectsPeriodicGroups(
        limit: 10000
        filter: {datetime_geq: $since, datetime_lt: $until}
      ) {
        dimensions { name }
        sum { rowsRead rowsWritten }
      }
    }
  }
}`

// What one store did, as the analytics answer them. Bytes come from the store
// itself, and the month from the row being written (directory.ts `Meter` is
// the whole component).
export type Counts = {
  requests: number
  rows_read: number
  rows_written: number
}

type Group = { dimensions?: { name?: string }; sum?: Record<string, number> }
type Answer = {
  data?: {
    viewer?: {
      accounts?: {
        durableObjectsInvocationsAdaptiveGroups?: Group[]
        durableObjectsPeriodicGroups?: Group[]
      }[]
    }
  }
  errors?: { message?: string }[] | null
}

export let monthOf = (at: Date) => at.toISOString().slice(0, 7)

// Bytes as a person says them. The meter is read out loud in tool answers,
// where `241 MB` is the number and `252706816` is noise.
export let size = (bytes: number) => {
  let units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = 0
  while (bytes >= 1024 && n < units.length - 1) {
    bytes /= 1024
    n++
  }
  // A tenth where it says something — 1.5 KB — and never where it does not:
  // the ceiling is 1 GB, and `1.0 GB` reads like a measurement of it.
  let round = !n || bytes >= 10 || Number.isInteger(bytes)
  return `${round ? Math.round(bytes) : bytes.toFixed(1)} ${units[n]}`
}

let none = (): Counts => ({ requests: 0, rows_read: 0, rows_written: 0 })

// The answer as rows, by store name. A group with no name is nothing to
// attribute — and a name that is no app of ours (`cf-singleton-container`) is
// simply never asked for.
export let read = (answer: Answer) => {
  let said = answer.errors?.length
    ? answer.errors.map((e) => e.message).join('; ')
    : ''
  if (said) throw new Error(`analytics: ${said}`)
  let account = answer.data?.viewer?.accounts?.[0]
  let by = new Map<string, Counts>()
  let of = (name: string) => {
    let row = by.get(name)
    if (!row) by.set(name, row = none())
    return row
  }
  for (let g of account?.durableObjectsInvocationsAdaptiveGroups ?? []) {
    if (g.dimensions?.name) {
      of(g.dimensions.name).requests += g.sum?.requests ?? 0
    }
  }
  for (let g of account?.durableObjectsPeriodicGroups ?? []) {
    if (!g.dimensions?.name) continue
    let row = of(g.dimensions.name)
    row.rows_read += g.sum?.rowsRead ?? 0
    row.rows_written += g.sum?.rowsWritten ?? 0
  }
  return by
}

// One call to the analytics API. A token that cannot read analytics answers
// 200 with `errors`, so both failures are one throw (`read` above).
export let ask = async (
  token: string,
  account: string,
  since: string,
  until: string,
  api = GRAPHQL,
): Promise<Answer> => {
  let r = await fetch(api, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { account, since, until },
    }),
  })
  if (!r.ok) {
    throw new Error(
      `analytics: HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`,
    )
  }
  return await r.json() as Answer
}

// What a store weighs right now, off its own door. A store that has never
// been touched answers zero rather than failing the whole sweep.
export let bytesOf = async (env: Env, name: string) => {
  let r = await storeOf(env.STORE, name)('/graph')
  if (!r.ok) return 0
  return Number((await r.json() as { bytes?: number }).bytes ?? 0)
}

// The month's counters for an entity that may have none, or whose row is a
// month behind: a new month is a fresh reading, never a running total.
export let thisMonth = (meter: Meter | null, month: string) =>
  meter && meter.month == month ? meter : null

// The hourly reading. Returns how many rows it wrote, so a caller (and the
// log) can say whether it found anything at all.
export let sweep = async (env: Env, now = new Date()) => {
  if (!env.CF_ANALYTICS_TOKEN) {
    console.log('yak-meter: no CF_ANALYTICS_TOKEN — nothing metered')
    return 0
  }
  let month = monthOf(now)
  let at = now.toISOString()
  let counts = read(
    await ask(
      env.CF_ANALYTICS_TOKEN,
      env.CF_ACCOUNT ?? '',
      `${month}-01T00:00:00Z`,
      at,
    ),
  )
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let entities: Bundle[] = []
  for (let space of await dir.all()) {
    let total = { ...none(), bytes: 0 }
    let apps = await dir.apps(space)
    for (let app of apps) {
      let name = storeName(space, app)
      let bytes = await bytesOf(env, name)
      let got = counts.get(name) ?? none()
      entities.push({
        entity: { eid: app.eid },
        meter: { month, ...got, bytes, at },
      })
      total.requests += got.requests
      total.rows_read += got.rows_read
      total.rows_written += got.rows_written
      total.bytes += bytes
    }
    // The space's own reading: its apps summed.
    let meter = { month, ...total, at }
    // A space that has just crossed a line — or fallen back under one — has
    // something new to hear, so the mark that it was told goes (unseen.ts
    // `ceiling` writes it back). A level that has not moved keeps its mark,
    // which is what makes the line ride ONE reply.
    let moved = level({ ...space, meter }, apps.length) !=
      level(space, apps.length)
    entities.push({
      entity: { eid: space.eid },
      meter,
      ...(moved ? { notified: null } : {}),
      // Every space is on the free tier until Stripe says otherwise
      // (D-32751); one that already carries a plan keeps it.
      ...(space.tier ? {} : { plan: { tier: 'free' } }),
    })
  }
  if (entities.length) await stamp(env, { entities })
  return entities.length
}

// What the sweep reports on the log: one line, whatever happened.
export let metered = async (env: Env, now = new Date()) => {
  let n = await sweep(env, now)
  if (n) console.log(`yak-meter: ${n} rows at ${now.toISOString()}`)
  return n
}

// ---- the ceilings (T-32758) ------------------------------------------------
//
// Adoption over revenue (T-32756): a ceiling is something the person's agent
// SEES COMING and is told about, not a wall the person hits. So only what
// costs money is refused outright — a sixth app, data past the ceiling — and
// requests past 50,000 are served and reported. At 80% of
// any of them the agent gets one line on the unseen channel (unseen.ts
// `ceiling`), marked the way an error is, so it rides one reply.

let GB = 1024 ** 3

// The free tier, as decided (D-32751): what a space gets for nothing.
export let FREE = { apps: 5, requests: 50_000, bytes: GB }

// Where the warning line sits, as a fraction of a ceiling.
export let WARN = 0.8

// What a tier is held to. Nothing is on `plus` yet — it waits on Stripe
// (T-32760) — and a space that somehow is answers to no ceiling here rather
// than to the free one.
export let ceilings = (tier: Tier | null) => tier == 'plus' ? null : FREE

let empty = (month: string): Meter => ({ month, ...none(), bytes: 0, at: '' })

// This month's reading, whatever the row holds — a month behind is nothing
// spent, and no row at all is the same.
export let spent = (space: Space, now = new Date()) =>
  thisMonth(space.meter, monthOf(now)) ?? empty(monthOf(now))

// How full a space is, per ceiling, as a fraction: 1 is at it.
export let fullness = (space: Space, apps: number, now = new Date()) => {
  let free = ceilings(space.tier)
  let m = spent(space, now)
  return free
    ? {
      apps: apps / free.apps,
      requests: m.requests / free.requests,
      bytes: m.bytes / free.bytes,
    }
    : null
}

// Where a space stands: nothing to say, near a ceiling, or past one. The
// sweep watches this for a change, which is what un-tells the agent.
export let level = (space: Space, apps: number, now = new Date()) => {
  let full = fullness(space, apps, now)
  if (!full) return 'ok'
  let worst = Math.max(...Object.values(full))
  return worst >= 1 ? 'over' : worst >= WARN ? 'near' : 'ok'
}

let count = (n: number) => n.toLocaleString('en-US')

// When the metered figures were last read. Everything but the app count comes
// from the hourly sweep above, not from a live counter, so a line that prints
// those numbers bare reads as live and looks broken: the ninth user test made
// ~25 requests to a new app and was told `0 of 50,000 requests` (C-32869
// item 6). A reading says its hour; no reading says so instead of saying zero.
let asOf = (at: string) => {
  let read = new Date(at)
  return Number.isNaN(read.getTime())
    ? ''
    : ` (as of ${read.toISOString().slice(11, 16)} UTC)`
}

// The line the agent reads: every number against its ceiling, and what
// happens at each. One line, because the agent has work to get back to.
export let standing = (space: Space, apps: number, now = new Date()) => {
  let free = ceilings(space.tier)
  if (!free) return `${space.slug}: no ceilings on this plan.`
  let m = spent(space, now)
  let refused = `Requests are never refused; a sixth app, or data past ${
    size(free.bytes)
  }, is. What the plans hold: ${PRICING}`
  let head = `${space.slug} (free tier, ${m.month}): ${apps} of ${free.apps} ` +
    'apps'
  let read = asOf(m.at)
  // The apps are counted here and now; the rest waits on the sweep. Before
  // the first one this month there is no reading at all, and zero would be a
  // claim rather than a number.
  if (!read) {
    return `${head}. The month's requests and data have not been ` +
      `read yet — the meter sweeps hourly. ${refused}`
  }
  return `${head}, ${count(m.requests)} of ${count(free.requests)} requests, ` +
    `${size(m.bytes)} of ${size(free.bytes)}${read}. ${refused}`
}

// The refusal, one sentence: what the ceiling is, and where the plans are
// written down. Every door that says no says it this way.
//
// It names the PRICING PAGE and never a checkout link, and that is a policy
// line rather than a preference (C-33033 on D-32751): an agent surface may
// explain that a feature needs a plan and may link to a page describing the
// plans; it may not hand back anything that starts a purchase. Paying is the
// signed-in web page's door (billing.ts).
export let atCeiling = (space: Space, what: 'apps' | 'bytes') => {
  let free = ceilings(space.tier)!
  let said = {
    apps: `${space.slug} is on the free tier, which is ${free.apps} apps` +
      ` — delete one (app_delete) to make another`,
    bytes: `${space.slug} is on the free tier, which is ${
      size(free.bytes)
    } of app data — delete what it no longer needs to save more`,
  }[what]
  return `${said}. Plus lifts it: ${PRICING}`
}

// The byte ceiling, at the two doors that add data (apps.ts): the space's
// last reading, with THIS app's share swapped for what its store weighs now
// and the bytes on their way in added. The live read only happens near the
// ceiling — under it an hour-old figure is close enough, and asking would
// double the Durable Object requests we are metering in the first place.
//
// It is the STORE's bytes: an app's uploaded files live in R2, which nothing
// meters per space yet (D-32751 open question 2), so those count only as the
// bytes of the request carrying them.
export let full = async (
  env: Env,
  space: Space,
  app: App,
  extra = 0,
  now = new Date(),
) => {
  let free = ceilings(space.tier)
  if (!free) return ''
  let month = monthOf(now)
  let held = thisMonth(space.meter, month)?.bytes ?? 0
  if (held + extra < free.bytes * WARN) return ''
  let mine = thisMonth(app.meter, month)?.bytes ?? 0
  let live = await bytesOf(env, storeName(space, app))
  return held - mine + live + extra > free.bytes
    ? atCeiling(space, 'bytes')
    : ''
}
