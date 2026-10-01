// The meter (D-32751 §Billing and metering, T-32757): what each app and each
// space spent this calendar month, read from Cloudflare's own analytics rather
// than counted in our code. Every app store is a Durable Object named
// `<space>/<app>` (directory.ts `storeName`), and its namespace turns that
// name into an object id. Analytics groups by that id, so two deployments
// may hold the same app handle without mixing their bills.
//
// The sweep is the meter plugin's effect rule (meter.ts), matching `fired`
// on its hourly directory wake: one GraphQL call for the month so far and one
// write into the meta store — `meter` on each app, `meter` on each space (its
// apps summed, what it spent left where meter.ts `spend` adds it up), and
// `plan{free}` on a space that has none yet — after a spend of nothing on
// each space whose meter is on another month. The write carries the kernel
// flag, because a person never states their own bill. It asks no store
// anything: a request to one would be a request the next reading counts.
//
// Two datasets, because one does not carry both numbers:
// `durableObjectsInvocationsAdaptiveGroups` has `sum.requests` by invocation
// type, `durableObjectsPeriodicGroups` has inbound socket messages and rows,
// both carry `dimensions.objectId`. Stored bytes are not from analytics:
// `durableObjectsStorageGroups` is account-wide, with no per-object dimension,
// so an app's size is what its own store told the directory when a write last
// moved it (meter.ts `weighed`). The sweep leaves that figure where it is and
// adds a space's up from it.
// The datasets are documented at
// https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
// which describes namespace and object metrics. Object ids identify the
// same object across both datasets and remain distinct across deployments.
//
// Without CF_ANALYTICS_TOKEN only R2 storage is measured; analytics readings
// remain untouched until that binding is configured.
//
// What a space is allowed — the ceilings, the letters, the line the agent
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
import { bound, type Env } from './env.ts'
import {
  atCeiling,
  ceilings,
  type Counts,
  FILES,
  level,
  monthOf,
  none,
  spent,
  thisMonth,
  WARN,
} from './meter.ts'
import { GRAPH, mail } from './mail.ts'
import { replyTo } from './host.ts'
import { KERNEL, meta } from './meta.ts'
import { type Alerts, type Usage, warning } from './usage-alert.ts'

export let GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'

// The whole month so far, grouped by Durable Object id. Invocation type
// separates hibernated socket messages from ordinary requests; periodic
// metrics carry messages received while the object was active. `limit` is
// the group count, not the request count.
export let QUERY =
  `query Meter($account: string!, $since: string!, $until: string!) {
  viewer {
    accounts(filter: {accountTag: $account}) {
      durableObjectsInvocationsAdaptiveGroups(
        limit: 10000
        filter: {datetime_geq: $since, datetime_lt: $until}
      ) {
        dimensions { objectId type }
        sum { requests }
      }
      durableObjectsPeriodicGroups(
        limit: 10000
        filter: {datetime_geq: $since, datetime_lt: $until}
      ) {
        dimensions { objectId }
        sum { rowsRead rowsWritten inboundWebsocketMsgCount }
      }
      accountInvocations: durableObjectsInvocationsAdaptiveGroups(
        limit: 1
        filter: {datetime_geq: $since, datetime_lt: $until}
      ) { sum { requests } }
      accountPeriodic: durableObjectsPeriodicGroups(
        limit: 1
        filter: {datetime_geq: $since, datetime_lt: $until}
      ) { sum { rowsRead duration inboundWebsocketMsgCount } }
    }
  }
}`

type Group = {
  dimensions?: { objectId?: string; type?: string }
  sum?: {
    requests?: number
    rowsRead?: number
    rowsWritten?: number
    duration?: number
    inboundWebsocketMsgCount?: number
  }
}
type Answer = {
  data?: {
    viewer?: {
      accounts?: {
        durableObjectsInvocationsAdaptiveGroups?: Group[]
        durableObjectsPeriodicGroups?: Group[]
        accountInvocations?: Group[]
        accountPeriodic?: Group[]
      }[]
    }
  }
  errors?: { message?: string }[] | null
}

// The answer as rows, by object id. A group with no id has nobody to charge;
// an id outside this deployment is never matched by its store binding.
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
    if (g.dimensions?.objectId) {
      let row = of(g.dimensions.objectId)
      let n = g.sum?.requests ?? 0
      row.requests += n
      if (g.dimensions.type == 'hibernation') {
        row.ws_hibernated += n
        row.ws_messages += n
      }
    }
  }
  for (let g of account?.durableObjectsPeriodicGroups ?? []) {
    if (!g.dimensions?.objectId) continue
    let row = of(g.dimensions.objectId)
    row.ws_messages += g.sum?.inboundWebsocketMsgCount ?? 0
    row.rows_read += g.sum?.rowsRead ?? 0
    row.rows_written += g.sum?.rowsWritten ?? 0
  }
  return by
}

// Unlike the app meter, the alert covers the whole Cloudflare account: its
// directory object, other Workers and any object not named by this deploy.
// The ungrouped aliases are one row each, so the 10,000-app meter limit cannot
// truncate these totals. Active-socket messages live in periodic metrics;
// hibernated-socket messages live in invocations. Add both as raw events so
// this early warning cannot miss either path; billing discounts them later.
export let accountOf = (answer: Answer, now: Date): Usage | null => {
  let account = answer.data?.viewer?.accounts?.[0]
  if (!account) return null
  if (!account.accountInvocations || !account.accountPeriodic) {
    throw new Error('analytics: account usage is absent')
  }
  return {
    month: monthOf(now),
    at: now.toISOString(),
    requests: (account.accountInvocations[0]?.sum?.requests ?? 0) +
      (account.accountPeriodic[0]?.sum?.inboundWebsocketMsgCount ?? 0),
    rows_read: account.accountPeriodic[0]?.sum?.rowsRead ?? 0,
    duration: account.accountPeriodic[0]?.sum?.duration ?? 0,
  }
}

let accountAlert = async (env: Env, usage: Usage) => {
  let graph = meta(env)
  let [row] = await graph.query('.entity.eid=yak-meter') as {
    account_usage?: Usage
    account_alert?: Alerts
  }[]
  let { body, next } = warning(
    row?.account_usage ?? null,
    usage,
    row?.account_alert ?? null,
  )
  if (body) {
    await mail(env)({
      to: [GRAPH, replyTo(env)],
      subject: 'Cloudflare Durable Object usage alert',
      body,
    })
  }
  await graph.apply([{
    entity: { eid: 'yak-meter' },
    account_usage: usage,
    account_alert: next,
  }], KERNEL)
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

// What an app holds, as its store last told the directory. Not read through
// `thisMonth`: bytes held are not a month's spending, so a new month keeps the
// figure until a write moves it.
let held = (app: App) => app.meter?.bytes ?? 0

// The hourly reading. Returns how many rows it wrote, so a caller (and the
// log) can say whether it found anything at all.
export let sweep = async (env: Env, now = new Date()) => {
  let month = monthOf(now)
  let at = now.toISOString()
  let answer = env.CF_ANALYTICS_TOKEN
    ? await ask(
      env.CF_ANALYTICS_TOKEN,
      env.CF_ACCOUNT ?? '',
      `${month}-01T00:00:00Z`,
      at,
    )
    : null
  let counts = answer ? read(answer) : null
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let entities: Bundle[] = []
  let turned: Bundle[] = []
  for (let space of await dir.all()) {
    let files = await filesOf(env, space)
    // R2 accounting does not depend on the analytics credential. Leave the
    // analytics timestamp/month untouched when only storage was measured.
    if (!counts) {
      let apps = (await dir.apps(space)).length
      let meter = { ...spent(space, now), files }
      let moved =
        level({ ...space, meter }, apps, now) != level(space, apps, now)
      entities.push({
        entity: { eid: space.eid },
        meter: { files },
        ...(moved ? { notified: null } : {}),
      })
      continue
    }
    let total = { ...none(), bytes: 0, files }
    let apps = await dir.apps(space)
    for (let app of apps) {
      let name = storeName(space, app)
      let got = counts.get(String(env.STORE.idFromName(name))) ?? none()
      // No `bytes`: the store's own figure stands, and a patch leaves it.
      entities.push({
        entity: { eid: app.eid },
        meter: { month, ...got, at },
      })
      total.requests += got.requests
      total.ws_messages += got.ws_messages
      total.ws_hibernated += got.ws_hibernated
      total.rows_read += got.rows_read
      total.rows_written += got.rows_written
      total.bytes += held(app)
    }
    // The space's own reading: its apps summed, and nothing it spent. What a
    // space spends (letters, builds, models, voice, seconds) is counted where
    // it happens and added up by the directory (meter.ts `spend`), and a
    // reading that carried it back would write over a count that landed
    // while the sweep ran. A space whose meter is on another month is turned
    // to this one first, by a spend of nothing (`turned`), in the directory's
    // own transaction, which starts the month over without losing a count.
    let meter = { month, ...total, at }
    if (!thisMonth(space.meter, month)) {
      turned.push({ entity: { eid: space.eid }, spend: { month } })
    }
    // A space that has just crossed a line — or fallen back under one — has
    // something new to hear, so the mark that it was told goes (unseen.ts
    // `ceiling` writes it back). A level that has not moved keeps its mark,
    // which is what makes the line ride one reply.
    let after = { ...space, meter: { ...spent(space, now), ...meter } }
    let moved = level(after, apps.length, now) != level(space, apps.length, now)
    entities.push({
      entity: { eid: space.eid },
      meter,
      ...(moved ? { notified: null } : {}),
      // Every space is on the free tier until Stripe says otherwise
      // (D-32751); one that already carries a plan keeps it.
      ...(space.tier ? {} : { plan: { tier: 'free' } }),
    })
  }
  if (turned.length) await stamp(env, { entities: turned })
  if (entities.length) await stamp(env, { entities })
  let account = answer && accountOf(answer, now)
  if (account) await accountAlert(env, account)
  return entities.length + (account ? 1 : 0)
}

// What the sweep reports on the log: one line, whatever happened.
export let metered = async (env: Env, now = new Date()) => {
  let n = await sweep(env, now)
  if (n) console.log(`yak-meter: ${n} rows at ${now.toISOString()}`)
  return n
}

// The byte ceiling, at the door that adds data (apps.ts): the space's last
// reading, and near the ceiling what its apps' stores have told the directory
// since, with the bytes on their way in added. Under the ceiling an hour-old
// figure is close enough; near it the directory is asked, never the stores —
// a store says its own size after every write that moves it.
//
// App data only; photos and files have their own R2 ceiling below.
export let full = async (
  env: Env,
  space: Space,
  extra = 0,
  now = new Date(),
) => {
  let free = ceilings(space.tier, space.slug)
  if (!free) return ''
  let read = thisMonth(space.meter, monthOf(now))?.bytes ?? 0
  if (read + extra < free.bytes * WARN) return ''
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let holding = (await dir.apps(space)).reduce((n, app) => n + held(app), 0)
  return holding + extra > free.bytes ? atCeiling(space, 'bytes', env) : ''
}

// Space-owned R2 objects: live files, uploaded blobs, trash and local history.
// Shared sha/ pins are platform retention, not attributable physical bytes of
// one space. The trailing slash prevents a space from counting a slug sibling.
let fileSizes = async (env: Env, space: Space) => {
  let sizes = new Map<string, number>()
  let cursor: string | undefined
  do {
    let page = await env.BLOBS.list({ prefix: `${space.slug}/`, cursor })
    for (let object of page.objects) sizes.set(object.key, object.size)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return sizes
}

export let filesOf = async (env: Env, space: Space) =>
  [...(await fileSizes(env, space)).values()].reduce((sum, n) => sum + n, 0)

// Read R2 itself at upload time: the hourly reading cannot authorize a burst
// of uploads or a new month's first upload. Use actual body sizes, never the
// caller's Content-Length. Overwrites spend only growth; duplicates spend none.
export let fullFiles = async (
  env: Env,
  space: Space,
  writes: { key: string; bytes: number }[],
) => {
  let sizes = await fileSizes(env, space)
  let held = [...sizes.values()].reduce((sum, n) => sum + n, 0)
  let delta = 0
  // A batch may repeat a path; parallel puts can finish in either order.
  let incoming = new Map<string, number>()
  for (let w of writes) {
    incoming.set(w.key, Math.max(incoming.get(w.key) ?? 0, w.bytes))
  }
  for (let [key, bytes] of incoming) {
    delta += bytes - (sizes.get(key) ?? 0)
  }
  return delta > 0 && held + delta > FILES[space.tier ?? 'free']
    ? atCeiling(space, 'files', env)
    : ''
}
