// How long a thread was held, and whether the box held it. Linux keeps, for
// each thread, the time it ran on a CPU and the time it waited, runnable, for
// one (/proc/<thread>/schedstat). A span's own time is its wall clock less
// that wait: what it would have taken on an idle box. A busy box stretches
// every thread's wall clock by its wait and by nothing else, so a span judged
// by its own time reports what the code did, never how busy the box was.

/** What a thread has spent since it started, in ms: on a CPU, and waiting
 * for one. */
export type Spent = { cpu: number; wait: number }

/** What `thread` (a path under /proc: `thread-self`, or `<pid>/task/<tid>`)
 * has spent; undefined where the platform does not say. */
export let spent = (thread: string): Spent | undefined => {
  try {
    let [cpu, wait] = Deno.readTextFileSync(`/proc/${thread}/schedstat`)
      .split(' ').map(Number)
    return Number.isFinite(wait)
      ? { cpu: cpu / 1e6, wait: wait / 1e6 }
      : undefined
  } catch {
    return undefined
  }
}

/** This thread's path under /proc, as {@link spent} takes it from another
 * thread of the same process; undefined where the platform has none. */
export let thread = (): string | undefined => {
  try {
    return Deno.readLinkSync('/proc/thread-self')
  } catch {
    return undefined
  }
}

/// since({ cpu: 1, wait: 2 }, { cpu: 4, wait: 7 }) -> { cpu: 3, wait: 5 }
/// since(undefined, { cpu: 4, wait: 7 }) -> undefined
/** What was spent between two readings of one thread. */
export let since = (a?: Spent, b?: Spent): Spent | undefined =>
  a && b ? { cpu: b.cpu - a.cpu, wait: b.wait - a.wait } : undefined

/// own(10_000, { cpu: 2000, wait: 7000 }) -> 3000
/// own(10_000, undefined) -> 10_000
/** A span's own time: `ms` of wall clock less what the thread waited for a
 * CPU in it. Where the platform does not say, all of it. */
export let own = (ms: number, s?: Spent): number => ms - (s?.wait ?? 0)

let secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/// how('its worker', 10_000, { cpu: 1500, wait: 7000 }) -> 'in 10.0 s its worker ran 1.5 s on a CPU, waited 7.0 s for one and was off one 1.5 s'
/// how('its worker', 10_000) -> 'the platform does not say how its worker spent 10.0 s'
/** How `who` spent `ms` of wall clock. Time off a CPU not waiting for one is
 * a call that blocked it: a lock, the disk, memory paged back in. */
export let how = (who: string, ms: number, s?: Spent): string =>
  s
    ? `in ${secs(ms)} ${who} ran ${secs(s.cpu)} on a CPU, waited ` +
      `${secs(s.wait)} for one and was off one ${
        secs(Math.max(0, ms - s.cpu - s.wait))
      }`
    : `the platform does not say how ${who} spent ${secs(ms)}`

/** Watches this thread's event loop with a tick every `every` ms. A tick that
 * comes `after` ms late or more of its own time means the thread was held by
 * its own work or a call that blocked: that is told to `report`, with how it
 * spent the time. One late only because the box kept it waiting for a CPU is
 * a line to `note`. Returns its stop. */
export let stalls = ({
  report,
  note = console.warn,
  every = 1000,
  after = 5000,
  read = () => spent('thread-self'),
  now = () => performance.now(),
  tick = (fn: () => void, ms: number) => {
    let id = setInterval(fn, ms)
    Deno.unrefTimer(id)
    return () => clearInterval(id)
  },
}: {
  report: (error: Error) => void
  note?: (line: string) => void
  every?: number
  after?: number
  read?: () => Spent | undefined
  now?: () => number
  /** run `fn` every `ms` and return its stop */
  tick?: (fn: () => void, ms: number) => () => void
}): () => void => {
  let last = now(), was = read()
  return tick(() => {
    let at = now(), is = read()
    let gap = at - last, s = since(was, is)
    last = at
    was = is
    let late = gap - every
    if (late < after) return
    let said = `the main thread was held ${secs(late)}`
    let why = how('the main thread', gap, s)
    if (own(late, s) < after) return note(`${said}, by the box: ${why}`)
    report(Object.assign(new Error(said, { cause: new Error(why) }), {
      name: 'Stalled',
    }))
  }, every)
}
