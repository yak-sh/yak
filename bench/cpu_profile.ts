/** What a page spent its time on while it painted, read from what Chrome
 * gives through DevTools: a CPU profile (`Profiler.stop`) and the counters of
 * `Performance.getMetrics` taken before and after. Pure: the bench records
 * them (./pages.ts) and the monitor says them in the bug it files
 * (./monitor.ts).
 *
 * ```ts
 * import { said, summary } from './cpu_profile.ts'
 * let frame = (functionName: string, url: string, lineNumber: number) =>
 *   ({ functionName, url, lineNumber })
 * let s = summary({
 *   nodes: [
 *     { id: 1, callFrame: frame('(root)', '', -1), children: [2] },
 *     { id: 2, callFrame: frame('render', 'http://x/web/app.js', 9), children: [3] },
 *     { id: 3, callFrame: frame('land', 'http://x/web/app.js', 41) },
 *   ],
 *   samples: [2, 3, 3],
 *   timeDeltas: [1000, 2000, 2000],
 * }, { ScriptDuration: 0.5 }, { ScriptDuration: 0.6, LayoutDuration: 0.02 })
 * s.self[0] // { name: 'land app.js:42', ms: 4 }
 * s.total[0] // { name: 'render app.js:10', ms: 5 }
 * s.metrics.ScriptDuration // 100
 * said(s, 1)
 * // 'script 100 ms, layout 20 ms; self: land app.js:42 4 ms; with callees: render app.js:10 5 ms'
 * ```
 *
 * @module
 */

/** A V8 CPU profile, as `Profiler.stop` answers it. */
export type CpuProfile = {
  nodes: {
    id: number
    callFrame: { functionName: string; url: string; lineNumber: number }
    children?: number[]
  }[]
  samples: number[]
  timeDeltas: number[]
}

/** A function and the milliseconds sampled in it. */
export type Spent = { name: string; ms: number }

/** What a paint spent: the functions with the most time of their own, those
 * with the most time counting what they call, and Chrome's counters moved
 * across it (durations in ms, counts as counted). */
export type Summary = {
  self: Spent[]
  total: Spent[]
  metrics: Record<string, number>
}

// Chrome's counters that say where a page's main thread went.
let DURATIONS = [
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'TaskDuration',
]
let COUNTS = ['LayoutCount', 'RecalcStyleCount', 'Nodes', 'JSHeapUsedSize']
// Frames that are the profiler's own bookkeeping, not the page's work.
let QUIET = new Set(['(root)', '(program)', '(idle)'])

let label = (f: CpuProfile['nodes'][number]['callFrame']) =>
  `${f.functionName || '(anonymous)'}${
    f.url ? ` ${f.url.split('/').at(-1)}:${f.lineNumber + 1}` : ''
  }`

let top = (spent: Map<string, number>, n: number): Spent[] =>
  [...spent].filter(([name]) => !QUIET.has(name))
    .sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, us]) => ({ name, ms: Math.round(us / 1000) }))

/** A profile and the counters around it, summarized to the `n` heaviest
 * functions each way. */
export let summary = (
  p: CpuProfile,
  before: Record<string, number>,
  after: Record<string, number>,
  n = 12,
): Summary => {
  let byId = new Map(p.nodes.map((x) => [x.id, x]))
  let up = new Map<number, number>()
  for (let x of p.nodes) for (let c of x.children ?? []) up.set(c, x.id)
  let self = new Map<string, number>(), total = new Map<string, number>()
  p.samples.forEach((id, i) => {
    let us = p.timeDeltas[i] ?? 0
    let own = label(byId.get(id)!.callFrame)
    self.set(own, (self.get(own) ?? 0) + us)
    let seen = new Set<string>()
    for (let x: number | undefined = id; x != null; x = up.get(x)) {
      let name = label(byId.get(x)!.callFrame)
      if (!seen.has(name)) {
        seen.add(name), total.set(name, (total.get(name) ?? 0) + us)
      }
    }
  })
  let metrics = Object.fromEntries([
    ...DURATIONS.filter((k) => k in after).map((k) =>
      [k, Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000)] as const
    ),
    ...COUNTS.filter((k) => k in after).map((k) =>
      [k, (after[k] ?? 0) - (before[k] ?? 0)] as const
    ),
  ])
  return { self: top(self, n), total: top(total, n), metrics }
}

let named = (s: Spent[]) => s.map((x) => `${x.name} ${x.ms} ms`).join(', ')

/** A summary in one line: Chrome's durations, then the `n` heaviest
 * functions by their own time and counting their callees. */
export let said = (s: Summary, n = 5): string =>
  [
    [
      ['script', 'ScriptDuration'],
      ['layout', 'LayoutDuration'],
      ['style', 'RecalcStyleDuration'],
      ['tasks', 'TaskDuration'],
    ].filter(([, k]) => k in s.metrics)
      .map(([word, k]) => `${word} ${s.metrics[k]} ms`).join(', '),
    `self: ${named(s.self.slice(0, n))}`,
    `with callees: ${named(s.total.slice(0, n))}`,
  ].join('; ')
