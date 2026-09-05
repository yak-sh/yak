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
// `meter` on each app, `meter` on each space (its apps summed, its letters
// left where the mail doors count them), and `plan{free}` on a space that has
// none yet. The write carries the kernel flag, because a person never states
// their own bill.
//
// Two datasets, because one does not carry both numbers:
// `durableObjectsInvocationsAdaptiveGroups` has `sum.requests`,
// `durableObjectsPeriodicGroups` has `sum.rowsRead`/`sum.rowsWritten`, and
// both carry `dimensions.name`. Stored bytes are NOT from analytics:
// `durableObjectsStorageGroups` is account-wide, with no per-object dimension,
// so an app's size is what its own store reports (graph.ts `/graph`).
// The datasets are documented at
// https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
// which names introspection as the way to read their fields; these field
// names came from introspecting the account's own schema.
//
// Without CF_ANALYTICS_TOKEN there is nothing to ask, so the sweep says one
// line on the log and returns: the secret is the owner's to set (T-32759), and
// a deploy standing before they do must not fail every hour.
//
// What a space is ALLOWED — the ceilings, the letters, the line the agent
// reads and the sentence a door says no with — is meter.ts, which this half
// reads and the Store object reads too.
import type { Bundle } from '@yaks/graph'
import * as dirPart from './directory.ts'
import {
  type App,
  directory,
  type Space,
  stamp,
  storeName,
} from './directory.ts'
import { storeOf } from './door.ts'
import { bound, type Env } from './env.ts'
import {
  atCeiling,
  ceilings,
  type Counts,
  level,
  monthOf,
  none,
  spent,
  thisMonth,
  WARN,
} from './meter.ts'

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
    // The space's own reading: its apps summed, and the figures counted where
    // they happen left alone — the mail doors count the letters and the
    // builder counts its builds (mail and a build ride no store), and this
    // sweep is only what starts them over when the month turns. `built` is the
    // one it never starts over: the free plan's build is for the life of the
    // space, so `spent` carries that figure across the month (meter.ts).
    let was = spent(space, now)
    let meter = {
      month,
      ...total,
      emails: was.emails,
      builds: was.builds,
      tokens: was.tokens,
      seconds: was.seconds,
      built: was.built,
      at,
    }
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
