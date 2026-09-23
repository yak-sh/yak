// The pull, as a duty: the module a server imports at `@yaks/mail/service` to
// take what arrived at the edge for as long as the server is up (./pull.ts).
//
// It is a loop rather than an effect because nothing is committed when a
// letter reaches the edge; the graph has to ask. It is a duty rather than a
// timer every process starts because the edge hands each letter to whoever
// asks first — the host holds it under a lease, so one process over the graph
// pulls at a time, and a one-shot command does one pull only when nobody else
// is.
//
// A config that names no `pull` has nothing to take, and the duty ends at
// once.

import type { Graph } from '@yaks/graph'
import { sleep } from '@yaks/effects'
import type { Options } from './options.ts'
import { edge, pull } from './pull.ts'

/** How long a pull waits for the next one, unless the config says. */
export let EVERY = 10_000

/** Pull what arrived, then again every `pull.every`, until the signal aborts —
 * an already-aborted signal is one pull. */
export let service = async (
  host: { graph: Graph },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  if (!options.pull) return
  let from = edge(options.pull)
  let at = {
    graph: host.graph,
    ...(options.domain ? { domain: options.domain } : {}),
    ...(options.triage ? { triage: options.triage } : {}),
  }
  for (;;) {
    await pull(at, from)
    if (signal.aborted) return
    await sleep(options.pull.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}
