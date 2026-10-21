// What the runtime killed for its limits with nobody there to see it: a
// Durable Object's alarm, or a message on one of its hibernated sockets
// (M-37965). A kill runs none of our code, so the object cannot say so, and
// its alarm's retry cannot tell a kill from a move or a deploy's restart. A
// fetch's kill is reported by the caller its words reach (door.ts,
// @yaks/durable-object `killed`). For these two the only record is
// Cloudflare's own: the outcome of every invocation, by the object's name,
// minute and version, in the same analytics the meter reads (usage.ts).
//
// The directory's kill sweep (facets/kills-graph.ts) reads the minutes since
// the last run finished and reports each kill it finds, once.
import { ask, said } from './analytics.ts'
import { defect } from './defects.ts'
import type { Env } from './env.ts'

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

// One occurrence per minute an object was killed in, on the version it ran.
// The message names what was killed and how, so a CPU kill and a memory kill
// are two bugs; the object's name rides as its tag.
let reported = (report: typeof defect) => ({ dimensions: d, sum }: Kill) =>
  report(
    new Error(
      `a Durable Object's ${WHAT[d.type] ?? d.type} was killed: ${d.status}`,
    ),
    {
      request: d.type,
      store: d.name || d.objectId,
      at: d.datetimeMinute,
      count: String(sum.requests),
    },
    d.scriptVersion ? { commit: d.scriptVersion } : {},
  )

/** Read the kills since `through` and report each, to the tracker unless a
 * `report` is given. Answers how far it read, for the next run to read on
 * from, or null when it read nothing. */
export let swept = async (
  env: Env,
  through: string | null | undefined,
  now: number,
  report: typeof defect = defect,
): Promise<string | null> => {
  let window = span(through, now)
  if (!window || !env.CF_ANALYTICS_TOKEN) return null
  let answer = await ask<Data>(env, QUERY, {
    account: env.CF_ACCOUNT ?? '',
    script: env.WORKER_NAME ?? 'yak',
    ...window,
  })
  let kills = said(answer)?.viewer?.accounts?.[0]
    ?.durableObjectsInvocationsAdaptiveGroups ?? []
  kills.forEach(reported(report))
  return window.until
}
