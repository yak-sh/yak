/** Match a limit kill to the work that started and did not finish in the
 * killed invocation. Workers Logs holds the marks even when code no longer
 * runs. Analytics remains the authority on whether a kill occurred. */
export let MARK = 'yak alarm work'

export type Mark = {
  message: typeof MARK
  job: string
  mark: string
  phase: 'start' | 'end'
}

export let marked = async <T>(
  job: string,
  run: () => T | Promise<T>,
  log: (mark: Mark) => void = console.log,
): Promise<T> => {
  let mark = String(crypto.randomUUID())
  log({ message: MARK, job, mark, phase: 'start' })
  try {
    return await run()
  } finally {
    log({ message: MARK, job, mark, phase: 'end' })
  }
}

type Event = {
  timestamp: number
  source?: Partial<Mark>
  $metadata?: { requestId?: string; traceId?: string }
  $workers?: {
    eventType?: string
    outcome?: string
    durableObjectId?: string
    scriptVersion?: { id?: string }
  }
}
type Filter = { key: string; operation: string; value: string; type: 'string' }
let filter = (key: string, value: string, operation = 'eq'): Filter => ({
  key,
  operation,
  value,
  type: 'string',
})

type Query = {
  account: string
  token: string
  script: string
  since: string
  until: string
}
let events = async (q: Query, filters: Filter[], go: typeof fetch) => {
  let response = await go(
    `https://api.cloudflare.com/client/v4/accounts/${q.account}/workers/observability/telemetry/query`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + q.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        queryId: 'yak-alarm-kills',
        view: 'events',
        limit: 1000,
        timeframe: { from: Date.parse(q.since), to: Date.parse(q.until) },
        parameters: {
          datasets: ['cloudflare-workers'],
          filters: [filter('$metadata.service', q.script), ...filters],
          filterCombination: 'and',
        },
      }),
      signal: AbortSignal.timeout(8000),
    },
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw Error(`Workers Logs answered ${response.status}`)
  }
  let answer = await response.json() as {
    success?: boolean
    result?: { events?: { count?: number; events?: Event[] } }
  }
  let result = answer.result?.events
  if (!answer.success || !result) {
    throw Error('Workers Logs answered no events')
  }
  let rows = result.events ?? []
  return (result.count ?? rows.length) > rows.length ? [] : rows
}

type Kill = {
  object: string
  minute: number
  version?: string
  status: string
  jobs: string[]
  trace?: string
}

let jobsOf = (marks: Event[]): string[] => {
  let began = new Map<string, string>(), ended = new Set<string>()
  for (let { source } of marks) {
    if (source?.message != MARK || !source.mark || !source.job) continue
    if (source.phase == 'start') began.set(source.mark, source.job)
    if (source.phase == 'end') ended.add(source.mark)
  }
  return [
    ...new Set([...began].filter(([id]) => !ended.has(id)).map(([, j]) => j)),
  ]
    .sort()
}

/** The job names come from the same runtime request as the kill. A mark
 * from another alarm, including a retry in the same minute, says nothing
 * about this invocation. Detached work can have more than one active job. */
export let alarmKills = async (
  q: Query,
  go: typeof fetch = fetch,
): Promise<Kill[]> => {
  let killed = await events(q, [
    filter('$workers.eventType', 'alarm'),
    filter('$workers.outcome', 'exceeded', 'starts_with'),
  ], go)
  let ids = killed.flatMap((e) => e.$metadata?.requestId ?? [])
  if (!ids.length) return []
  let marks = await events({
    ...q,
    since: new Date(Date.parse(q.since) - 15 * 60_000).toISOString(),
  }, [
    filter('$metadata.requestId', ids.join(','), 'in'),
    filter('$metadata.message', MARK),
  ], go)
  return killed.flatMap((event) => {
    let { durableObjectId: object, outcome: status, scriptVersion } =
      event.$workers ?? {}
    let request = event.$metadata?.requestId
    if (!object || !status || !request) return []
    return [{
      object,
      minute: Math.floor(event.timestamp / 60_000) * 60_000,
      version: scriptVersion?.id,
      status,
      jobs: jobsOf(marks.filter((e) => e.$metadata?.requestId == request)),
      trace: event.$metadata?.traceId,
    }]
  })
}
