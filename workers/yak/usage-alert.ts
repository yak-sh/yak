// Account-wide usage warnings: Durable Objects, and the Workers every visit to
// an app passes through (yak-front, the kernel). Cloudflare owns the readings;
// this pure half decides when a new threshold or a new spending spike is worth
// a letter. The hourly sweep keeps the previous reading and sent levels. A
// letter is all a spike earns: no visitor is ever refused to keep a bill down.

// What the Workers Paid plan includes each month, and what a million more of
// each costs (workers/yak/README.md, What a million views cost). A row written
// costs what a thousand rows read do.
let plan = {
  requests: { name: 'DO incoming events', included: 1_000_000, price: 0.15 },
  rows_read: { name: 'DO rows read', included: 25e9, price: 0.001 },
  rows_written: { name: 'DO rows written', included: 50e6, price: 1 },
  duration: { name: 'DO duration (GB-s)', included: 400_000, price: 12.5 },
  workers: { name: 'Workers requests', included: 10_000_000, price: 0.30 },
  cpu: { name: 'Workers CPU (ms)', included: 30_000_000, price: 0.02 },
}
type Metric = keyof typeof plan
let metrics = Object.keys(plan) as Metric[]

export type Usage = { month: string; at: string } & Record<Metric, number>
export type Alerts = { month: string; rate: string } & Record<Metric, string>

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
  let delta = (key: Metric) =>
    before[key] == null ? 0 : Math.max(0, now[key] - before[key]) / hours * 24
  return metrics.reduce(
    (sum, key) => sum + delta(key) * plan[key].price / 1e6,
    0,
  )
}

export let warning = (
  before: Usage | null,
  now: Usage,
  sent: Alerts | null,
) => {
  let old = sent?.month == now.month ? sent : null
  let next = {
    month: now.month,
    rate: old?.rate ?? '',
    ...Object.fromEntries(metrics.map((key) => [key, old?.[key] ?? ''])),
  } as Alerts
  let lines: string[] = []
  for (let key of metrics) {
    let { name, included } = plan[key]
    let standing = level(now[key], included)
    if (rank(standing) > rank(next[key])) {
      let used = now[key].toLocaleString('en-US')
      let limit = included.toLocaleString('en-US')
      lines.push(
        key == 'requests'
          ? `DO incoming events: ${used} raw (${standing} the ${limit}-event ` +
            'early-warning proxy; the allowance is 1M billable request units)'
          : `${name}: ${used} of ${limit} included (${standing})`,
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
