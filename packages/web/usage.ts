// The usage projection: a READ over token counts already stamped on settled
// sessions (session.usage_json), folded into cost and throughput. It captures
// nothing new — it reads the graph we already have and rolls it up the edges we
// already have (session → requested_task → its project), so the owner can ask
// what a week of agent work cost and get an answer that isn't a guess.
//
// The one invariant, paid for in blood: ABSENT BEATS ZERO. A token count a
// provider never reported stays absent all the way through; it never folds to a
// free 0. Every rolled number therefore carries its own `n` — the count of
// sessions that actually reported it — so a sum of three sessions where only
// one reported cache reads says so, instead of averaging in two invented zeros.
// Cost obeys the same law one level up: a model with no price in `rates`
// contributes NO cost and is absent from cost.n, never billed at $0.

import { adapters } from './adapters.ts'
import { kilo, type Session, type Tokens } from './types.ts'

// One session's usage, projected onto the dimensions we roll up by. `task` is
// the requested_task id (provenance); `project` is left for the caller to
// attach, since it lives one edge away (task → project) that only the graph
// reader holds. `ms` is WALL-CLOCK — the throughput denominator, deliberately
// the observed elapsed time and not any provider self-report of latency.
export type Use = {
  session: string
  provider?: string
  model?: string
  persona?: string
  task?: string
  project?: string
  usage: Tokens
  ms?: number
}

// Wall-clock elapsed, in ms, or undefined when either end is missing or the
// pair is nonsensical (unparseable, or finished before it started).
export let wall = (started?: string | null, finished?: string | null) => {
  if (!started || !finished) return undefined
  let a = Date.parse(started)
  let b = Date.parse(finished)
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : undefined
}

// Normalize one settled session, or null when it carried no usage we can read
// (no blob, unknown provider, or a provider with no usage reader). The vendor
// dialect is decoded at the adapter — this module never learns a provider's
// field names.
export let use = (s: Session): Use | null => {
  if (!s.usage_json || !s.provider) return null
  let adapter = adapters[s.provider]
  if (!adapter?.usage) return null
  let raw: unknown
  try {
    raw = JSON.parse(s.usage_json)
  } catch {
    return null
  }
  let usage = adapter.usage(raw)
  if (!usage) return null
  return {
    session: s.id ?? s.eid,
    ...(s.provider ? { provider: s.provider } : {}),
    ...(s.serving_model ?? s.model
      ? { model: s.serving_model ?? s.model! }
      : {}),
    ...(s.persona ? { persona: s.persona } : {}),
    ...(s.requested_task ? { task: s.requested_task } : {}),
    usage,
    ...(wall(s.started_at, s.finished_at) != null
      ? { ms: wall(s.started_at, s.finished_at) }
      : {}),
  }
}

// A rolled number: the total, and how many members reported it. `n` is the
// whole point — it is how absent stays legible after summing.
export type Sum = { total: number; n: number }

// A rollup of many Uses. `n` counts the members; each token facet and `ms`
// carry their own Sum, present only if at least one member reported it.
export type Roll = {
  n: number
  input?: Sum
  cache_read?: Sum
  cache_creation?: Sum
  output?: Sum
  ms?: Sum
}

// Fold one value into a Sum — absent leaves the Sum untouched (and absent).
let add = (sum: Sum | undefined, v?: number): Sum | undefined =>
  v == null ? sum : { total: (sum?.total ?? 0) + v, n: (sum?.n ?? 0) + 1 }

// Set a Sum key only when it exists — keeps an all-absent facet off the Roll.
let onto = (k: keyof Roll, sum?: Sum) => sum ? { [k]: sum } : {}

export let fold = (r: Roll, u: Use): Roll => ({
  n: r.n + 1,
  ...onto('input', add(r.input, u.usage.input)),
  ...onto('cache_read', add(r.cache_read, u.usage.cache_read)),
  ...onto('cache_creation', add(r.cache_creation, u.usage.cache_creation)),
  ...onto('output', add(r.output, u.usage.output)),
  ...onto('ms', add(r.ms, u.ms)),
})

export let roll = (uses: Use[]): Roll => uses.reduce(fold, { n: 0 })

// Group Uses by a caller-chosen dimension. A key of undefined DROPS the row —
// a session with no persona simply isn't in the persona breakdown, rather than
// landing in a bogus '' bucket.
export let group = (
  uses: Use[],
  keyOf: (u: Use) => string | undefined,
): Map<string, Use[]> => {
  let out = new Map<string, Use[]>()
  for (let u of uses) {
    let k = keyOf(u)
    if (k == null) continue
    let bucket = out.get(k)
    if (bucket) bucket.push(u)
    else out.set(k, [u])
  }
  return out
}

// Throughput: output tokens per wall-clock second — the degradation
// discriminator. Undefined unless both output and elapsed time are known.
export let tokS = (r: Roll): number | undefined =>
  r.output && r.ms && r.ms.total > 0
    ? r.output.total / (r.ms.total / 1000)
    : undefined

// Cache hit rate: reads as a fraction of all input offered (reads + writes +
// fresh). Undefined unless cache reads were reported and there was input.
export let hitRate = (r: Roll): number | undefined => {
  if (!r.cache_read) return undefined
  let denom = r.cache_read.total + (r.cache_creation?.total ?? 0) +
    (r.input?.total ?? 0)
  return denom > 0 ? r.cache_read.total / denom : undefined
}

// --- cost ----------------------------------------------------------------
// List prices in µUSD per token (µUSD/token == $/1M numerically — $5/1M input
// is 5). The table is deliberately small and editable in one place; a model
// with no entry gets NO cost (absent, never $0), which is the honest answer for
// providers we don't price (codex/gpt). Cache reads bill at 10% of input, cache
// writes at 125% — Anthropic's standard multipliers.
export type Rate = { input: number; output: number }

export let rates: Record<string, Rate> = {
  opus: { input: 5, output: 25 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
  fable: { input: 10, output: 50 },
}

let CACHE_READ = 0.1
let CACHE_WRITE = 1.25

// The rate for a model id, matched by family substring, or undefined when we
// don't price it. Mythos shares Fable's price.
export let rateOf = (model?: string): Rate | undefined => {
  if (!model) return undefined
  let m = model.toLowerCase()
  return m.includes('opus')
    ? rates.opus
    : m.includes('sonnet')
    ? rates.sonnet
    : m.includes('haiku')
    ? rates.haiku
    : m.includes('fable') || m.includes('mythos')
    ? rates.fable
    : undefined
}

// Cost of one Use in µUSD, or undefined when its model isn't priced. An absent
// token tier adds nothing — a missing count is genuinely $0 of that tier, and
// the RATE's presence is what carries absent-beats-zero at the cost level.
export let costOf = (u: Use): number | undefined => {
  let r = rateOf(u.model)
  if (!r) return undefined
  let g = u.usage
  let c = (g.input ?? 0) * r.input + (g.output ?? 0) * r.output +
    (g.cache_read ?? 0) * r.input * CACHE_READ +
    (g.cache_creation ?? 0) * r.input * CACHE_WRITE
  return Math.round(c)
}

// Total cost over Uses, in µUSD, with n = how many were priced. n < uses.length
// means some sessions ran on models we don't price — the number covers only
// what it can, and says how much.
export let cost = (uses: Use[]): Sum =>
  uses.reduce(
    (s, u) => {
      let c = costOf(u)
      return c == null ? s : { total: s.total + c, n: s.n + 1 }
    },
    { total: 0, n: 0 },
  )

// µUSD → a dollar string. Sub-cent totals keep four decimals so a cheap run
// doesn't read as free.
export let usd = (micro: number): string => {
  let d = micro / 1e6
  return d > 0 && d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toFixed(2)}`
}

// --- report --------------------------------------------------------------
// One text table shared by the CLI and MCP so the two doors can't disagree.
// A dimension we roll up by; `session` is per-run, the rest join up the graph.
export type Dim = 'model' | 'project' | 'persona' | 'task' | 'provider'

// TOTAL first, then the groups by the chosen dimension costliest-first, and a
// note when cost covers only some sessions. label() maps an eid key to its
// human id; a plain value (a model name) passes through. Absent facets read `—`.
export let report = (
  uses: Use[],
  by: Dim,
  label: (k: string) => string = (k) => k,
): string => {
  if (!uses.length) return '(no settled sessions with usage)'
  let tok = (s?: Sum) => (s ? kilo(s.total) : '—').padStart(7)
  let money = (c: Sum) => (c.n ? usd(c.total) : '—').padStart(10)
  let rate = (r: Roll) => {
    let t = tokS(r)
    return (t == null ? '—' : `${Math.round(t)}/s`).padStart(8)
  }
  let pct = (r: Roll) => {
    let h = hitRate(r)
    return (h == null ? '' : `${Math.round(h * 100)}%`).padStart(5)
  }
  let line = (key: string, us: Use[]) => {
    let r = roll(us)
    return `${key.padEnd(18)} ${String(r.n).padStart(4)} ${tok(r.input)} ${
      tok(r.cache_read)
    } ${tok(r.cache_creation)} ${tok(r.output)} ${money(cost(us))} ${rate(r)} ${
      pct(r)
    }`
  }
  let head = `${by.padEnd(18)} ${'sess'.padStart(4)} ${'in'.padStart(7)} ${
    'cache↓'.padStart(7)
  } ${'cache↑'.padStart(7)} ${'out'.padStart(7)} ${'cost'.padStart(10)} ${
    'tok/s'.padStart(8)
  } ${'hit'.padStart(5)}`
  let groups = [...group(uses, (u) => u[by]).entries()]
    .sort((a, b) => cost(b[1]).total - cost(a[1]).total)
  let lines = [
    head,
    line('TOTAL', uses),
    ...groups.map(([k, us]) => line(label(k), us)),
  ]
  let c = cost(uses)
  if (c.n < uses.length) {
    lines.push(`\ncost covers ${c.n}/${uses.length} sessions (rest unpriced)`)
  }
  return lines.join('\n')
}
