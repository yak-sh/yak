// Picking the agents a restart left running back up: the duty a host holds at
// `@yaks/spawn` (@yaks/cli `Host.duties`) for as long as it is up.
//
// An agent outlives whoever launched it, by design, so a fresh server finds
// runs it has no memory of — a pid in a row, a log file with unread lines in
// it — and {@link resume} picks both back up. Following a run is tailing its log
// until it ends, and a second tail over one log imports every line twice, so
// one process follows them, and it keeps the right to for as long as its tails
// run: the duty's lease, which the host renews while the process is up and
// gives back when it closes.
//
// It goes on looking while it holds the duty ({@link takeUp}), every `sweep`
// ms: a process that is leaving can still finish a start it began, after this
// one looked, and one that ends mid-start leaves a session taken that nothing
// launched. Both are this duty's to take up.
//
// A one-shot command is handed the pass with a signal that has already
// aborted, and adopts nothing. Its tails would outlive the lease it gives back
// on its way out, and the next process to take the lease would tail the same
// logs beside them. The lines wait in the log, and the process that stays up
// reads them on from where the transcript stands.

import type { Graph } from '@yaks/graph'
import { type Options, reporting } from './effects.ts'
import { type Opts, type Report, resume, takeUp } from './run.ts'

/** How often the duty looks again for runs nobody reads (ms). */
export let SWEEP = 30_000

// A pause that ends early when the duty does.
let pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((go) => {
    let timer = setTimeout(go, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), go()), {
      once: true,
    })
  })

/**
 * The duty, with providers of your own added — the same `adapters` a server
 * with its own providers hands `spawning` (./effects.ts).
 *
 * ```ts ignore
 * import { adopting } from '@yaks/spawn/service'
 * import { adapters } from '@yaks/spawn'
 *
 * export let service = adopting({ adapters: { ...adapters, mine } })
 * ```
 */
export let adopting = (o: Opts & { sweep?: number } = {}) =>
async (
  host: { graph: Graph; report?: Report },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  if (signal.aborted) return
  let report = reporting(o, host)
  let opts: Opts = { ...options, ...o, signal, report }
  await resume(host.graph, opts).catch(report)
  while (!signal.aborted) {
    await pause(o.sweep ?? SWEEP, signal)
    if (!signal.aborted) await takeUp(host.graph, opts).catch(report)
  }
}

/** The duty, with the providers this package ships. */
export let service: ReturnType<typeof adopting> = adopting()
