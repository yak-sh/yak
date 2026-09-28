// Account-wide Durable Object usage warnings. Cloudflare owns the readings;
// this pure half decides when a new threshold or a new spending spike is worth
// a letter. The hourly sweep keeps the previous reading and sent levels.

export type Usage = {
  month: string
  at: string
  requests: number
  rows_read: number
  duration: number
}

export type Alerts = {
  month: string
  requests: string
  rows_read: string
  duration: string
  rate: string
}

let limits = { requests: 1_000_000, rows_read: 25e9, duration: 400_000 }
let names = {
  requests: 'DO incoming events',
  rows_read: 'DO rows read',
  duration: 'DO duration (GB-s)',
}
let metrics = ['requests', 'rows_read', 'duration'] as const
let rank = (level: string) => level == 'over' ? 2 : level == 'near' ? 1 : 0
let level = (used: number, included: number) =>
  used >= included ? 'over' : used >= included * 0.8 ? 'near' : ''

// The raw invocation count is an early warning, not billed request units:
// Cloudflare bills incoming WebSocket messages 20:1 and its analytics keeps
// their unweighted count. The price projection is therefore an upper bound.
let daily = (before: Usage | null, now: Usage) => {
  if (!before || before.month != now.month) return 0
  let hours = (Date.parse(now.at) - Date.parse(before.at)) / 3_600_000
  if (hours < 0.5 || hours > 3) return 0
  let delta = (key: typeof metrics[number]) =>
    Math.max(0, now[key] - before[key]) / hours * 24
  return delta('rows_read') / 1e9 +
    delta('requests') * 0.15 / 1e6 +
    delta('duration') * 12.5 / 1e6
}

export let warning = (
  before: Usage | null,
  now: Usage,
  sent: Alerts | null,
) => {
  let old = sent?.month == now.month ? sent : null
  let next: Alerts = {
    month: now.month,
    requests: old?.requests ?? '',
    rows_read: old?.rows_read ?? '',
    duration: old?.duration ?? '',
    rate: old?.rate ?? '',
  }
  let lines: string[] = []
  for (let key of metrics) {
    let standing = level(now[key], limits[key])
    if (rank(standing) > rank(next[key])) {
      let used = now[key].toLocaleString('en-US')
      let limit = limits[key].toLocaleString('en-US')
      lines.push(
        key == 'requests'
          ? `DO incoming events: ${used} raw (${standing} the ${limit}-event ` +
            'early-warning proxy; the allowance is 1M billable request units)'
          : `${names[key]}: ${used} of ${limit} included (${standing})`,
      )
      next[key] = standing
    }
  }
  let projection = daily(before, now)
  let hot = projection >= 25 ? 'spike' : ''
  if (hot && !next.rate) {
    lines.push(
      `Recent rate projects up to $${projection.toFixed(0)}/day ` +
        'at overage rates if sustained',
    )
  }
  next.rate = hot
  let body = lines.length
    ? `Cloudflare account DO usage at ${now.at}:\n\n${lines.join('\n')}\n\n` +
      'Raw request events are an early-warning proxy, and the dollar rate ' +
      'is an upper bound: Cloudflare bills incoming WebSocket messages at ' +
      '20:1. Check the account billing page for billed usage.'
    : ''
  return { body, next }
}
