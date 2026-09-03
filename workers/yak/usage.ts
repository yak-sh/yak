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
// left where the send door counts them), and `plan{free}` on a space that has
// none yet. The write carries the kernel flag, because a person never states
// their own bill.
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
import type { EntityLiteral } from '../../src/mutation.ts'
import * as dirPart from './directory.ts'
import { directory, type Meter, stamp, storeName } from './directory.ts'
import { bound, type Env } from './env.ts'
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
// itself, and the month and the letters from the row being written
// (directory.ts `Meter` is the whole component).
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
  return `${n && bytes < 10 ? bytes.toFixed(1) : Math.round(bytes)} ${units[n]}`
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
  let entities: EntityLiteral[] = []
  for (let space of await dir.all()) {
    let total = { ...none(), bytes: 0 }
    for (let app of await dir.apps(space)) {
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
    // The space's own reading: its apps summed, and the letters it sent left
    // alone — the send door counts those (mail rides no store), and this
    // sweep is only what starts them over when the month turns.
    entities.push({
      entity: { eid: space.eid },
      meter: {
        month,
        ...total,
        emails: thisMonth(space.meter, month)?.emails ?? 0,
        at,
      },
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
