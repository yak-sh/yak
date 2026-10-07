/** Shared pieces of the box bench (./box.ts): how its children are started,
 * and how a recorded span tree is split into where its time went. */
import type { Event } from '@yaks/trace'

/** Every child the box bench starts runs without network permission, so a
 * plugin that tried to reach a model, a mail sender or a remote host would
 * fail loudly instead of acting. Git is the one program the CLI runs itself
 * (`revision()` for the tracker); nothing else may be spawned. */
export let PERMS = [
  '--allow-read',
  '--allow-write',
  '--allow-env',
  '--allow-sys',
  '--allow-ffi',
  '--allow-run=git',
  '--no-prompt',
]

/** The variables a child never inherits: which session a command speaks for
 * (a fleet agent's own, here), credentials, and anything that would point it
 * at another graph or host. */
let SCRUB = [
  'CLAUDE_CODE_SESSION_ID',
  'TASKS_SESSION',
  'CODEX_THREAD_ID',
  'OP_SERVICE_ACCOUNT_TOKEN',
  'YAK_CONFIG',
  'YAKS_HOST',
  'YAKS_TOKEN',
]

/** Batch sizes `apply()` is timed at, and how many applies of each a round
 * takes. */
export let BATCHES: [number, number][] = [
  [1, 15],
  [10, 7],
  [100, 5],
  [1000, 2],
]
/** Pending rows one pass of the effect pool is timed against. */
export let BACKLOGS: [string, number][] = [
  ['0', 0],
  ['1k', 1_000],
  ['100k', 100_000],
]
/** The in-process benches (./box-graph.ts). */
export let GRAPH = [
  ...BATCHES.map(([n]) => `apply/${n}`),
  'pool/owe',
  'pool/claim',
  'pool/run',
  'pool/settle',
  'pool/drain',
  ...BACKLOGS.map(([name]) => `pool/due ${name}`),
]

export let childEnv = (extra: Record<string, string> = {}) => {
  let env = Deno.env.toObject()
  for (let name of SCRUB) delete env[name]
  return { ...env, NO_COLOR: '1', ...extra }
}

/** The value at quantile `q` of `values`, nearest rank.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(quantile([5, 1, 3, 2, 4], 0.5), 3)
 * assertEquals(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10)
 * ```
 */
export let quantile = (values: readonly number[], q: number): number => {
  let sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
}

/** What a span's own time is charged to: SQL by statement, a plugin's hook
 * phases under the plugin, the graph's own phases by name. */
export let charge = (e: Event): string =>
  e.kind == 'sql'
    ? e.name == 'commit' || e.name == 'begin' ? `sql ${e.name}` : 'sql'
    : e.kind == 'phase'
    ? e.plugin ? `plugin ${e.plugin}` : `phase ${e.name}`
    : e.kind

/** Self time (a span's duration less its children's) summed by `by`, in ms.
 * The keys partition the roots' total time, so they add up to it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let span = (id: string, duration: number, parent?: string) =>
 *   ({ id, parent, kind: 'phase', name: id, stage: 'end', time: 0, duration })
 * assertEquals(
 *   split([span('a', 10), span('b', 4, 'a'), span('c', 1, 'b')] as never),
 *   { 'phase a': 6, 'phase b': 3, 'phase c': 1 },
 * )
 * ```
 */
export let split = (
  spans: readonly Event[],
  by: (e: Event) => string = charge,
): Record<string, number> => {
  let below = new Map<string, number>()
  for (let e of spans) {
    if (e.parent) {
      below.set(e.parent, (below.get(e.parent) ?? 0) + (e.duration ?? 0))
    }
  }
  let out: Record<string, number> = {}
  for (let e of spans) {
    if (e.duration == null) continue
    let own = Math.max(0, e.duration - (below.get(e.id) ?? 0))
    out[by(e)] = (out[by(e)] ?? 0) + own
  }
  return out
}

/** The SQL statements in a tree, by statement name: how many ran and how
 * long they took together (ms). */
export let statements = (spans: readonly Event[]) => {
  let out: Record<string, { n: number; ms: number }> = {}
  for (let e of spans) {
    if (e.kind != 'sql' || e.duration == null) continue
    let s = out[e.name] ??= { n: 0, ms: 0 }
    s.n++
    s.ms += e.duration
  }
  return out
}

/** Spans collected from a channel subscription, kept by id: a start event is
 * replaced by its end, so a finished span carries its duration. */
export let collector = () => {
  let events = new Map<string, Event>()
  return {
    add: (e: Event) => {
      if (e.stage == 'end' || !events.has(e.id)) events.set(e.id, e)
    },
    take: (): Event[] => {
      let out = [...events.values()]
      events.clear()
      return out
    },
  }
}
