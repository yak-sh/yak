// Account-wide usage warnings: Durable Objects, and the Workers every visit to
// an app passes through (yak-front, the kernel). Cloudflare owns the readings;
// this pure half decides when a new threshold or a new spending spike is worth
// a letter. The hourly sweep keeps the previous reading and sent levels. A
// letter is all a spike earns: no visitor is ever refused to keep a bill down.

export type Usage = {
  month: string
  at: string
  requests: number
  rows_read: number
  duration: number
  workers: number
  cpu: number
}

export type Alerts = {
  month: string
  requests: string
  rows_read: string
  duration: string
  workers: string
  cpu: string
  rate: string
}

// What the Workers Paid plan includes each month, and what more of each costs
// per unit (workers/yak/README.md, What a million views cost).
let limits = {
  requests: 1_000_000,
  rows_read: 25e9,
  duration: 400_000,
  workers: 10_000_000,
  cpu: 30_000_000,
}
let prices = {
  requests: 0.15 / 1e6,
  rows_read: 0.001 / 1e6,
  duration: 12.5 / 1e6,
  workers: 0.30 / 1e6,
  cpu: 0.02 / 1e6,
}
let names = {
  requests: 'DO incoming events',
  rows_read: 'DO rows read',
  duration: 'DO duration (GB-s)',
  workers: 'Workers requests',
  cpu: 'Workers CPU (ms)',
}
let metrics = ['requests', 'rows_read', 'duration', 'workers', 'cpu'] as const
let rank = (level: string) => level == 'over' ? 2 : level == 'near' ? 1 : 0
let level = (used: number, included: number) =>
  used >= included ? 'over' : used >= included * 0.8 ? 'near' : ''

// The raw invocation count is an early warning, not billed request units:
// Cloudflare bills incoming WebSocket messages 20:1 and its analytics keeps
// their unweighted count. The price projection is therefore an upper bound.
// A reading kept before a metric was read has none of it, and counts nothing.
let daily = (before: Usage | null, now: Usage) => {
  if (!before || before.month != now.month) return 0
  let hours = (Date.parse(now.at) - Date.parse(before.at)) / 3_600_000
  if (hours < 0.5 || hours > 3) return 0
  let delta = (key: typeof metrics[number]) =>
    before[key] == null ? 0 : Math.max(0, now[key] - before[key]) / hours * 24
  return metrics.reduce((sum, key) => sum + delta(key) * prices[key], 0)
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
    workers: old?.workers ?? '',
    cpu: old?.cpu ?? '',
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
    ? `Cloudflare account usage at ${now.at}:\n\n${lines.join('\n')}\n\n` +
      'Raw request events are an early-warning proxy, and the dollar rate ' +
      'is an upper bound: Cloudflare bills incoming WebSocket messages at ' +
      '20:1. Check the account billing page for billed usage.'
    : ''
  return { body, next }
}
