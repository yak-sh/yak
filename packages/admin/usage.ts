// The usage watch: what each Worker and each Durable Object on the account did
// in the last hour, beside what it does in an ordinary hour. Cloudflare keeps
// the numbers (its GraphQL Analytics API, read hourly by service.ts), so the
// watch keeps none: each look reads the hour and the two days before it, and
// a jump is a bug the box's reporter files, which reaches an agent through
// heal like any other. The box's tracker hears it from its spool, so a jump
// in the platform tracker itself is still filed while that tracker is the one
// misbehaving.
//
// A subject's normal is its median hour over the 48 before (an hour it did
// nothing counts as nothing). A jump is an hour at least `RISE` times that
// normal and past it by the metric's `floor`, an amount worth an agent's look:
// about a cent an hour at Cloudflare's prices, a few dollars a month if it
// stays. The platform tracker's bug pages (T-132729) went from 3M rows read an
// hour to 47M on 2026-10-17, and stayed for ten days.
import { derivedEid } from '@yaks/graph/identity'

export let HOUR = 3_600_000
/** The hours a subject's normal is the median of. */
export let BEFORE = 48
/** How many times its normal an hour must be to be a jump. */
export let RISE = 2

/** A measure of usage: where analytics keeps it, and how much more than
 * normal is worth a look. */
export type Metric = {
  name: string
  /** what the subject did, before its amount */
  did: string
  unit: string
  floor: number
}

export let METRICS: Record<string, Metric> = {
  rowsRead: { name: 'rowsRead', did: 'read', unit: 'rows', floor: 10e6 },
  rowsWritten: {
    name: 'rowsWritten',
    did: 'wrote',
    unit: 'rows',
    floor: 20_000,
  },
  duration: { name: 'duration', did: 'ran', unit: 'GB-s', floor: 1_000 },
  requests: {
    name: 'requests',
    did: 'answered',
    unit: 'requests',
    floor: 50_000,
  },
  cpuTimeUs: {
    name: 'cpuTimeUs',
    did: 'spent',
    unit: 'CPU seconds',
    floor: 600e6,
  },
}

/** Every Worker's and Durable Object's usage by the hour, from `since` to
 * `until`. The object's invocations by type are read for the last hour only:
 * they say which entry point (fetch, alarm, RPC, socket) did the work. */
export let QUERY =
  `query Usage($account: String!, $since: Time!, $until: Time!, $last: Time!) {
  viewer {
    accounts(filter: {accountTag: $account}) {
      workers: workersInvocationsAdaptive(
        limit: 10000
        filter: {datetime_geq: $since, datetime_lt: $until}
      ) {
        dimensions { scriptName datetimeHour }
        sum { requests cpuTimeUs }
      }
      stored: durableObjectsPeriodicGroups(
        limit: 10000
        filter: {datetime_geq: $since, datetime_lt: $until}
      ) {
        dimensions { namespaceId objectId datetimeHour }
        sum { rowsRead rowsWritten duration }
      }
      called: durableObjectsInvocationsAdaptiveGroups(
        limit: 10000
        filter: {datetime_geq: $since, datetime_lt: $until}
      ) {
        dimensions { scriptName namespaceId objectId datetimeHour }
        sum { requests }
      }
      entries: durableObjectsInvocationsAdaptiveGroups(
        limit: 10000
        filter: {datetime_geq: $last, datetime_lt: $until}
      ) {
        dimensions { scriptName namespaceId objectId name type }
        sum { requests }
      }
    }
  }
}`

type Group = {
  dimensions: Record<string, string | undefined>
  sum: Record<string, number>
}
export type Answer = {
  viewer?: {
    accounts?: {
      workers?: Group[]
      stored?: Group[]
      called?: Group[]
      entries?: Group[]
    }[]
  }
}

/** What the look asks Cloudflare for an hour (ms, on the hour). */
export let variables = (account: string, hour: number) => ({
  account,
  since: new Date(hour - BEFORE * HOUR).toISOString(),
  until: new Date(hour + HOUR).toISOString(),
  last: new Date(hour).toISOString(),
})

/** One subject's hours of one metric. */
export type Series = {
  /** `worker <script>` or `object <namespace> <object>` */
  subject: string
  metric: Metric
  hours: Map<number, number>
}

/** Who a subject is, in words and as tags. */
export type Who = {
  said: string
  tags: Record<string, string>
}

/** The answer as series, and who each subject is. */
export let readings = (answer: Answer) => {
  let account = answer.viewer?.accounts?.[0] ?? {}
  let series = new Map<string, Series>()
  let who = new Map<string, Who>()
  let add = (subject: string, group: Group, names: string[]) => {
    let at = Date.parse(group.dimensions.datetimeHour ?? '')
    for (let name of names) {
      let key = `${subject} ${name}`
      let s = series.get(key) ??
        { subject, metric: METRICS[name], hours: new Map() }
      s.hours.set(at, (s.hours.get(at) ?? 0) + (group.sum[name] ?? 0))
      series.set(key, s)
    }
  }
  let object = (d: Group['dimensions']) =>
    `object ${d.namespaceId} ${d.objectId}`
  for (let g of account.workers ?? []) {
    let subject = `worker ${g.dimensions.scriptName}`
    who.set(subject, {
      said: `The ${g.dimensions.scriptName} Worker`,
      tags: { worker: String(g.dimensions.scriptName) },
    })
    add(subject, g, ['requests', 'cpuTimeUs'])
  }
  for (let g of account.stored ?? []) {
    add(object(g.dimensions), g, ['rowsRead', 'rowsWritten', 'duration'])
  }
  for (let g of account.called ?? []) {
    let d = g.dimensions, subject = object(d)
    who.set(subject, {
      said: `${d.scriptName}'s Durable Object ${d.objectId?.slice(0, 12)}`,
      tags: {
        worker: String(d.scriptName),
        namespace: String(d.namespaceId),
        object: String(d.objectId),
      },
    })
    add(subject, g, ['requests'])
  }
  // The last hour's entry points, most first, and the object's name.
  let entries = new Map<string, Group[]>()
  for (let g of account.entries ?? []) {
    let subject = object(g.dimensions)
    entries.set(subject, [...entries.get(subject) ?? [], g])
  }
  for (let [subject, groups] of entries) {
    let known = who.get(subject)
    if (!known) continue
    let by = new Map<string, number>()
    for (let g of groups) {
      let type = String(g.dimensions.type)
      by.set(type, (by.get(type) ?? 0) + g.sum.requests)
    }
    let name = groups.find((g) => g.dimensions.name)?.dimensions.name
    let mix = [...by].sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${count(n)} ${type}`).join(', ')
    who.set(subject, {
      said: `${known.said}${name ? ` (named ${name})` : ''}`,
      tags: { ...known.tags, ...name ? { name } : {}, entries: mix },
    })
  }
  return { series: [...series.values()], who }
}

/// median([3, 1, 2]) -> 2
/// median([4, 1, 3, 2]) -> 2.5
/// median([]) -> 0
export let median = (xs: number[]) => {
  let s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return !s.length ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/// count(264528274) -> '264.5M'
/// count(480_000) -> '480k'
/// count(1340) -> '1,340'
/** An amount as a person reads it. */
export let count = (n: number) =>
  n >= 1e9
    ? `${+(n / 1e9).toFixed(1)}B`
    : n >= 1e6
    ? `${+(n / 1e6).toFixed(1)}M`
    : n >= 1e5
    ? `${Math.round(n / 1e3)}k`
    : Math.round(n).toLocaleString('en-US')

/** An hour a subject used far more of a metric than it normally does. */
export type Jump = {
  subject: string
  metric: Metric
  hour: number
  value: number
  normal: number
}

/// let hours = (xs: number[]) => new Map(xs.map((v, i) => [i * HOUR, v]))
/// let s = (xs: number[]) => [{ subject: 'worker w', metric: METRICS.rowsRead, hours: hours(xs) }]
/// jumps(s([...Array(48).fill(3e6), 47e6]), 48 * HOUR).length -> 1
/// jumps(s([...Array(48).fill(30e6), 47e6]), 48 * HOUR).length -> 0
/// jumps(s([...Array(48).fill(1e3), 5e6]), 48 * HOUR).length -> 0
/** The jumps of the hour at `hour` (ms, on the hour). */
export let jumps = (series: Series[], hour: number): Jump[] =>
  series.flatMap(({ subject, metric, hours }) => {
    let value = hours.get(hour) ?? 0
    let normal = median(
      Array.from(
        { length: BEFORE },
        (_, i) => hours.get(hour - (i + 1) * HOUR) ?? 0,
      ),
    )
    return value >= RISE * normal && value - normal >= metric.floor
      ? [{ subject, metric, hour, value, normal }]
      : []
  })

/** A jump, as the error the tracker is handed. */
export class UsageJump extends Error {
  override name = 'UsageJump'
}

/** A jump as the tracker files it: the error, and the context that groups
 * every hour of one subject's metric on one bug, an hour's report landing
 * once however often it is sent. */
export let report = (jump: Jump, who?: Who) => {
  let { subject, metric, hour, value, normal } = jump
  let fault = `usage jump|${subject}|${metric.name}`
  let at = new Date(hour).toISOString()
  let times = normal ? `, ${+(value / normal).toFixed(1)} times` : ''
  let entries = who?.tags.entries
    ? ` Its entry points: ${who.tags.entries}.`
    : ''
  return {
    error: new UsageJump(
      `${who?.said ?? subject} ${metric.did} ${count(value)} ${metric.unit} ` +
        `in the hour from ${at}${times} its normal of ${count(normal)} an ` +
        `hour, the median of the ${BEFORE} before (Cloudflare's analytics).` +
        entries,
    ),
    context: {
      fault,
      eid: derivedEid(`${fault}|${at}`),
      tags: {
        ...who?.tags,
        metric: metric.name,
        hour: at,
        value: String(value),
        normal: String(normal),
      },
    },
  }
}
