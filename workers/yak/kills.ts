// What the runtime killed for its limits with nobody there to see it: a
// Durable Object's alarm, or a message on one of its hibernated sockets
// (M-37965). A kill runs none of our code, so the object cannot say so, and
// its alarm's retry cannot tell a kill from a move or a deploy's restart. A
// fetch's kill is reported by the caller its words reach (door.ts,
// @yaks/durable-object `killed`). For these two the only record is
// Cloudflare's own: the outcome of every invocation, by the object's name,
// minute and version, in the same analytics the meter reads (usage.ts).
// Workers Logs can add the jobs still active in the killed invocation.
//
// The directory's kill sweep (jobs.ts `kills`) reads the minutes since
// the last run finished and reports each kill it finds, once.
import { ask, said } from '@yaks/cloudflare/analytics'
import { alarmKills } from '@yaks/cloudflare/alarm-logs'
import { defect } from './defects.ts'
import type { Env } from './env.ts'
import { sleep } from '@yaks/fp'

/** How often the sweep runs, and so how late a kill is heard. */
export let EVERY = '5m'
let STEP = 5 * 60_000
// How far behind now analytics has finished counting a minute.
let LAG = 5 * 60_000
// The furthest back a run reads after the sweep stood still.
let DAY = 86_400_000

export let QUERY =
  `query Kills($account: string!, $script: string!, $since: string!, $until: string!) {
  viewer {
    accounts(filter: {accountTag: $account}) {
      durableObjectsInvocationsAdaptiveGroups(
        limit: 1000
        filter: {
          datetime_geq: $since
          datetime_lt: $until
          scriptName: $script
          status_like: "exceeded%"
          type_in: ["alarm", "hibernation"]
        }
        orderBy: [datetimeMinute_ASC]
      ) {
        dimensions { datetimeMinute name objectId scriptVersion status type }
        sum { requests }
      }
    }
  }
}`

export type Kill = {
  dimensions: {
    datetimeMinute: string
    name?: string | null
    objectId: string
    scriptVersion?: string | null
    status: string
    type: string
  }
  sum: { requests: number }
}
type Data = {
  viewer?: {
    accounts?: { durableObjectsInvocationsAdaptiveGroups?: Kill[] }[]
  }
}

let minute = (ms: number) => new Date(ms - ms % 60_000).toISOString()

/**
 * The minutes a run reads: on from where the last one finished, up to the
 * minute analytics has finished counting, and never more than a day back.
 * The first run reads one step's worth. Nothing new to read is null.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let now = Date.parse('2026-10-13T15:12:30Z')
 * assertEquals(span(null, now), {
 *   since: '2026-10-13T15:02:00.000Z',
 *   until: '2026-10-13T15:07:00.000Z',
 * })
 * assertEquals(span('2026-10-13T15:01:00.000Z', now)?.since, '2026-10-13T15:01:00.000Z')
 * assertEquals(span('2026-10-01T00:00:00.000Z', now)?.since, '2026-10-12T15:07:00.000Z')
 * assertEquals(span('2026-10-13T15:07:00.000Z', now), null)
 * ```
 */
export let span = (through: string | null | undefined, now: number) => {
  let until = Date.parse(minute(now - LAG))
  let since = Math.max(
    through ? Date.parse(through) : until - STEP,
    until - DAY,
  )
  return since < until
    ? {
      since: new Date(since).toISOString(),
      until: new Date(until).toISOString(),
    }
    : null
}

let WHAT: Record<string, string> = {
  alarm: 'alarm',
  hibernation: 'socket message',
}

let reported = (
  report: typeof defect,
  d: Kill['dimensions'],
  count: number,
  jobs = '',
  trace?: string,
) => {
  let work = jobs ? `alarm (${jobs})` : WHAT[d.type] ?? d.type
  let error = new Error(`a Durable Object's ${work} was killed: ${d.status}`)
  // The runtime did not supply a stack for this invocation.
  delete error.stack
  report(
    error,
    {
      request: jobs ? `alarm ${jobs}` : d.type,
      ...jobs ? { jobs } : {},
      ...trace ? { trace } : {},
      store: d.name || d.objectId,
      at: d.datetimeMinute,
      count: String(count),
    },
    d.scriptVersion ? { commit: d.scriptVersion } : {},
  )
}

let note = (
  report: typeof defect,
  { dimensions: d, sum }: Kill,
  logs: Awaited<ReturnType<typeof alarmKills>>,
) => {
  let kept = d.type == 'alarm'
    ? logs.filter((log) =>
      log.object == d.objectId && log.minute == Date.parse(d.datetimeMinute) &&
      log.version == (d.scriptVersion || undefined) && log.status == d.status &&
      log.jobs.length
    )
    : []
  if (kept.length > sum.requests) kept = []
  for (let log of kept) reported(report, d, 1, log.jobs.join(', '), log.trace)
  if (kept.length < sum.requests) {
    reported(report, d, sum.requests - kept.length)
  }
}

/** Read the kills since `through` and report each, to the tracker unless a
 * `report` is given. Answers how far it read, for the next run to read on
 * from, or null when it read nothing. */
export let swept = async (
  env: Env,
  through: string | null | undefined,
  now: number,
  report: typeof defect = defect,
  wait: (ms: number) => Promise<void> = sleep,
  read: typeof ask<Data> = ask,
  observe = alarmKills,
): Promise<string | null> => {
  let window = span(through, now)
  if (!window || !env.CF_ANALYTICS_TOKEN) return null
  let account = env.CF_ACCOUNT ?? '', script = env.WORKER_NAME ?? 'yak'
  let answer = await read(env, QUERY, { account, script, ...window }, wait)
  let kills = said(answer)?.viewer?.accounts?.[0]
    ?.durableObjectsInvocationsAdaptiveGroups ?? []
  let token = env.CF_ALARM_LOGS_TOKEN
  let logs = token && account &&
      kills.some(({ dimensions }) => dimensions.type == 'alarm')
    ? await observe({ account, script, token, ...window }).catch((error) => {
      report(error, { request: 'alarm kill attribution' })
      return []
    })
    : []
  for (let kill of kills) note(report, kill, logs)
  return window.until
}
