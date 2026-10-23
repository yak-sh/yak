// What a worker says about itself. A process working the pool (./pool.ts)
// writes a `worker` component on its own process entity about once a second
// while it works:
//
//   worker{at, running, runs, ran, errors, history, cpu, lag}
//
// so anyone reading the graph sees how many workers are up, what each is
// running, how fast runs end and how busy each process is, without asking the
// process. A row whose `at` stops moving is a worker that stopped saying: it
// ended, or its thread is stuck. One leaving the pool takes its row with it.
//
// How busy is said in two ways that hold however many runs a worker takes at
// once: `cpu`, the share of a core its process used, and `lag`, how late its
// thread ran a timer, which climbs as its event loop fills.
//
// The counting and the reading are pure; the one timer is `lagging`'s.

/** The component a worker says itself in, by the name ./vocab.json declares
 * it. */
export let WORKER = 'worker'

/** How many seconds of `history` a worker keeps. */
export let SPAN = 60

/** How many of its runs a worker lists, oldest first. */
export let SHOWN = 20

/** A run going in a worker, as it lists it. */
export type Listed = {
  /** the run's `effect` row */
  run: string
  handler: string
  target: string
  /** when it started, ISO-8601 */
  since: string
}

/** What a worker says: the `worker` component. */
export type Worker = {
  at: string
  running: number
  runs: Listed[]
  ran: number
  errors: number
  history: number[]
  cpu?: number
  lag?: number
}

/**
 * Runs counted by the second they ended in, kept for `span` seconds: `count`
 * one at a moment (ms), and `last` reads the `span` whole seconds before a
 * moment, oldest first.
 */
/// let s = seconds(3)
/// s.count(1_000); s.count(1_500); s.count(2_100)
/// s.last(3_000) -> [0, 2, 1]
/// s.last(5_000) -> [1, 0, 0]
/// s.last(9_000) -> [0, 0, 0]
export let seconds = (span = SPAN) => {
  // One slot more than the span: the second still going.
  let size = span + 1
  let counts: number[] = Array(size).fill(0)
  let top = -Infinity
  let slot = (s: number) => ((s % size) + size) % size
  // Up to second `s`, emptying the seconds passed over.
  let roll = (s: number) => {
    if (s <= top) return
    if (s - top >= size) counts.fill(0)
    else for (let i = top + 1; i <= s; i++) counts[slot(i)] = 0
    top = s
  }
  return {
    count: (ms: number) => {
      let s = Math.floor(ms / 1000)
      roll(s)
      if (s > top - size) counts[slot(s)]++
    },
    last: (ms: number): number[] => {
      let s = Math.floor(ms / 1000)
      roll(s)
      return Array.from({ length: span }, (_, i) => counts[slot(s - span + i)])
    },
  }
}

/** Runs ended a second, over the last `n` seconds of a history. */
/// rate([9, 0, 0, 4, 6], 2) -> 5
/// rate([1, 2]) -> 0.3
/// rate([]) -> 0
export let rate = (history: number[], n = 10): number =>
  history.slice(-n).reduce((a, b) => a + b, 0) / n

/**
 * How late this thread runs a timer: one is set every `every` ms, and `read`
 * answers the most any ran past its time since the last read, in whole ms.
 * `stop` clears it.
 */
export let lagging = (every = 100) => {
  let worst = 0
  let due = performance.now() + every
  let look = () => {
    let now = performance.now()
    worst = Math.max(worst, now - due)
    due = now + every
    timer = setTimeout(look, every)
  }
  let timer = setTimeout(look, every)
  return {
    read: (): number => {
      let w = Math.max(0, Math.round(worst))
      worst = 0
      return w
    },
    stop: () => clearTimeout(timer),
  }
}

/** A worker's row read back, or nothing where there is none. */
/// said({ worker: { at: 'x', running: 2 } })?.running -> 2
/// said({ worker: { at: 'x' } })?.runs -> []
/// said({}) -> undefined
export let said = (b: Record<string, unknown>): Worker | undefined => {
  let w = b[WORKER] as Partial<Worker> | undefined
  if (!w?.at) return undefined
  return {
    at: w.at,
    running: w.running ?? 0,
    runs: w.runs ?? [],
    ran: w.ran ?? 0,
    errors: w.errors ?? 0,
    history: w.history ?? [],
    ...w.cpu != null ? { cpu: w.cpu } : {},
    ...w.lag != null ? { lag: w.lag } : {},
  }
}
