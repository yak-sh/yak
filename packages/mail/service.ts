// The pull, as a duty: the module a server imports at `@yaks/mail/service` to
// take what arrived at the edge for as long as the server is up (./pull.ts).
//
// It is a loop rather than an effect because nothing is committed when a
// letter reaches the edge; the graph has to ask. It is a duty rather than a
// timer every process starts because the edge hands each letter to whoever
// asks first — the host holds it under a lease, so one process over the graph
// pulls at a time. An explicit one-pass host pulls once when nobody else is.
//
// A config that names no `pull` has nothing to take, and the duty ends at
// once.

import type { Graph } from '@yaks/graph'
import { queue } from './door.ts'
import { sleep } from '@yaks/effects'
import type { Options, Pull } from './options.ts'
import { type Edge, edge, pull } from './pull.ts'

/** How long a pull waits for the next one, unless the config says. */
export let EVERY = 10_000

/** Pull from one edge, then again every `pull.every`, until the signal aborts.
 * An already-aborted signal is one pull. */
let polling = async (
  host: { graph: Graph },
  from: Edge | undefined,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  let at = {
    graph: host.graph,
    ...(options.domain ? { domain: options.domain } : {}),
    ...(options.triage ? { triage: options.triage } : {}),
    ...(options.inbox ? { inbox: options.inbox } : {}),
  }
  for (;;) {
    if (from) await pull(at, from)
    if (options.inbox) {
      let now = new Date().toISOString()
      let hour = options.inbox.hour ?? 9
      await queue(
        host.graph,
        host.graph.vocab,
        options.inbox,
        (b) => host.graph.apply(b),
        now,
        new Date(now).getUTCHours() >= hour,
      )
    }
    if (signal.aborted) return
    await sleep(options.pull?.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}

type Open = (options: Pull, stop?: AbortSignal) => Edge

let open: Open = (options, stop) => edge(options, fetch, stop)

/** Pull what arrived, then keep polling until the host stops. */
export let service = (
  host: { graph: Graph },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
  make: Open = open,
): Promise<void> => {
  if (!options.pull && !options.inbox) return Promise.resolve()
  // Already aborted means one pass. A live signal also stops an in-flight
  // edge request, so shutdown and a lost lease do not wait on the network.
  let stop = signal.aborted ? undefined : signal
  return polling(
    host,
    options.pull ? make(options.pull, stop) : undefined,
    options,
    signal,
  )
}
