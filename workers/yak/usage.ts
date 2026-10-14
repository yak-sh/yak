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
// adds a space's up from it, and lists the space's photos and files in the
// bucket, writing what each app's prefix holds on its row (held.ts).
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
import { patient } from '@yaks/blob'
import type { Bundle } from '@yaks/graph'
import * as dirPart from './directory.ts'
import {
  type App,
  directory,
  type Meter,
  type Space,
  stamp,
  storeName,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { holding } from './held.ts'
import {
  atStored,
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
import { type Answer as Asked, ask, said } from './analytics.ts'

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
type Data = {
  viewer?: {
    accounts?: {
      durableObjectsInvocationsAdaptiveGroups?: Group[]
      durableObjectsPeriodicGroups?: Group[]
      accountInvocations?: Group[]
      accountPeriodic?: Group[]
    }[]
  }
}
type Answer = Asked<Data>

// The answer as rows, by object id. A group with no id has nobody to charge;
// an id outside this deployment is never matched by its store binding.
export let read = (answer: Answer) => {
  let account = said(answer)?.viewer?.accounts?.[0]
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

// The hourly reading has nobody waiting on it, so it waits out a busy bucket
// for about a minute where an upload gives up within seconds: R2 refuses a
// list of a prefix that a burst of writes is landing in (10058).
let SWEEP = { tries: 8, wait: 500 }

// The hourly reading. Returns how many rows it wrote, so a caller (and the
// log) can say whether it found anything at all. A space whose files cannot be
// listed keeps its last figure, every other space is still read, and the first
// refusal is thrown once the rest has landed, so it is reported.
export let sweep = async (env: Env, now = new Date()) => {
  let month = monthOf(now)
  let at = now.toISOString()
  let answer = env.CF_ANALYTICS_TOKEN
    ? await ask<Data>(env.CF_ANALYTICS_TOKEN, QUERY, {
      account: env.CF_ACCOUNT ?? '',
      since: `${month}-01T00:00:00Z`,
      until: at,
    })
    : null
  let counts = answer ? read(answer) : null
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let entities: Bundle[] = []
  let turned: Bundle[] = []
  let refused: unknown[] = []
  for (let space of await dir.all()) {
    let apps = await dir.apps(space)
    let alive = apps.filter((a) => !a.trashed).length
    // What the space holds, app by app (held.ts). A space whose files cannot
    // be listed keeps its figures, its apps' too: with no listing, `holding`
    // reads them off the rows.
    let sizes = await fileSizes(env, space, SWEEP.tries, SWEEP.wait)
      .catch((e) => {
        refused.push(e)
        return undefined
      })
    let held = holding(space, apps, sizes)
    let filesOf = (app: App) => held.apps.get(app.slug)!.files
    // A space that has just crossed a line — or fallen back under one — has
    // something new to hear, so the mark that it was told goes (unseen.ts
    // `ceiling` writes it back). A level that has not moved keeps its mark,
    // which is what makes the line ride one reply.
    let was = level(space, alive, now)
    let moved = (meter: Partial<Meter>) => {
      let after = { ...space, meter: { ...spent(space, now), ...meter } }
      return level(after, alive, now) != was
    }
    // R2 accounting does not depend on the analytics credential. Leave the
    // analytics timestamp/month untouched when only storage was measured.
    if (!counts) {
      let meter = { bytes: held.bytes, files: held.files }
      entities.push({
        entity: { eid: space.eid },
        meter,
        ...(moved(meter) ? { notified: null } : {}),
      })
      for (let app of apps) {
        let files = filesOf(app)
        if (sizes && files != (app.meter?.files ?? 0)) {
          entities.push({ entity: { eid: app.eid }, meter: { files } })
        }
      }
      continue
    }
    let total = { ...none(), bytes: held.bytes, files: held.files }
    for (let app of apps) {
      let name = storeName(space, app)
      let got = counts.get(String(env.STORE.idFromName(name))) ?? none()
      // No `bytes`: the store's own figure stands, and a patch leaves it.
      entities.push({
        entity: { eid: app.eid },
        meter: { month, ...got, at, ...sizes ? { files: filesOf(app) } : {} },
      })
      total.requests += got.requests
      total.ws_messages += got.ws_messages
      total.ws_hibernated += got.ws_hibernated
      total.rows_read += got.rows_read
      total.rows_written += got.rows_written
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
    entities.push({
      entity: { eid: space.eid },
      meter,
      ...(moved(meter) ? { notified: null } : {}),
      // Every space is on the free tier until Stripe says otherwise
      // (D-32751); one that already carries a plan keeps it.
      ...(space.tier ? {} : { plan: { tier: 'free' } }),
    })
  }
  // A reading is maintenance, not use. Keep the existing last-write stamps;
  // spends and app byte reports still refresh them at their own doors.
  if (turned.length) await stamp(env, { entities: turned }, { stamp: false })
  if (entities.length) await stamp(env, { entities }, { stamp: false })
  let account = answer && accountOf(answer, now)
  if (account) await accountAlert(env, account)
  if (refused.length) throw refused[0]
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
  if (spent(space, now).bytes + extra < free.bytes * WARN) return ''
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let held = holding(space, await dir.apps(space))
  return held.bytes + extra > free.bytes
    ? atStored(space, 'bytes', held, env)
    : ''
}

// Space-owned R2 objects, each key with its size: live files, uploaded blobs,
// trash and local history. Shared sha/ pins are platform retention, not
// attributable physical bytes of one space. The trailing slash prevents a
// space from counting a slug sibling. `tries` and `wait` are `patient`'s: how
// long a busy bucket is waited out.
export let fileSizes = async (
  env: Env,
  space: Space,
  tries?: number,
  wait?: number,
) => {
  let sizes = new Map<string, number>()
  let cursor: string | undefined
  do {
    let page = await patient(
      () => env.BLOBS.list({ prefix: `${space.slug}/`, cursor }),
      tries,
      wait,
    )
    for (let object of page.objects) sizes.set(object.key, object.size)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return sizes
}

// The files ceiling, at every door that writes them, as `full` is for app
// data: under the warning line the hourly reading with every byte arriving
// added is close enough, and near it R2 itself is read. Listing a space's
// whole prefix on every upload is what R2 refuses a burst of uploads for
// (10058). Use actual body sizes, never the caller's Content-Length. Near the
// line, overwrites spend only growth and duplicates spend none. The refusal
// says what the listing found each app holds, which needs no app's row.
export let fullFiles = async (
  env: Env,
  space: Space,
  writes: { key: string; bytes: number }[],
  now = new Date(),
) => {
  let ceiling = FILES[space.tier ?? 'free']
  let arriving = writes.reduce((sum, w) => sum + w.bytes, 0)
  if ((spent(space, now).files ?? 0) + arriving < ceiling * WARN) return ''
  let sizes = await fileSizes(env, space)
  let held = holding(space, [], sizes)
  let delta = 0
  // A batch may repeat a path; parallel puts can finish in either order.
  let incoming = new Map<string, number>()
  for (let w of writes) {
    incoming.set(w.key, Math.max(incoming.get(w.key) ?? 0, w.bytes))
  }
  for (let [key, bytes] of incoming) {
    delta += bytes - (sizes.get(key) ?? 0)
  }
  return delta > 0 && held.files + delta > ceiling
    ? atStored(space, 'files', held, env)
    : ''
}
