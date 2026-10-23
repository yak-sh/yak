// The pull, as a duty: the module a server imports at `@yaks/mail/service` to
// take what arrived at the edge for as long as the server is up (./pull.ts).
//
// It is a loop rather than an effect because nothing is committed when a
// letter reaches the edge; the graph has to ask. It is a duty rather than a
// timer every process starts because the edge hands each letter to whoever
// asks first — the host holds it under a lease, so one process over the graph
// pulls at a time. An explicit one-pass host pulls once when nobody else is.
//
// A config that names no `pull` has nothing to take, but holds the duty
// until shutdown, like a configured poll between passes.

import type { Graph } from '@yaks/graph'
import type { Config } from '@yaks/host'
import { sleep } from '@yaks/effects'
import type { Options, Pull } from './options.ts'
import { type Edge, edge, LATE, pull, type Report } from './pull.ts'
import { readings } from './readings.ts'

/** How long a pull waits for the next one, unless the config says. */
export let EVERY = 10_000

type Host = { graph: Graph; config?: Config; report?: Report }

/** Pull from one edge, then again every `pull.every`, until the signal aborts.
 * An already-aborted signal is one pull, so a tray it cannot take is said at
 * once; a loop tries again and says it once the tray has been down for LATE. */
let polling = async (
  host: Host,
  from: Edge,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  let at = {
    graph: host.graph,
    ...(host.report ? { report: host.report } : {}),
    ...(options.domain ? { domain: options.domain } : {}),
    ...(options.triage ? { triage: options.triage } : {}),
    ...(signal.aborted ? {} : { down: new Map() }),
    readings: await readings(host.config?.plugins),
  }
  let began = Date.now()
  for (;;) {
    // A pass that starts long after the last one means the loop was not
    // running, whatever held it. It is told when it ends, with how long this
    // pass took, so the report says where the time went.
    let gap = Date.now() - began
    began = Date.now()
    await pull(at, from)
    if (gap > LATE + (options.pull?.every ?? EVERY)) {
      void host.report?.(
        new Error('@yaks/mail — the pull fell behind'),
        {
          tags: {
            step: 'mail stall',
            gap: `${gap} ms`,
            pass: `${Date.now() - began} ms`,
          },
        },
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
  host: Host,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
  make: Open = open,
): Promise<void> => {
  if (!options.pull) {
    if (signal.aborted) return Promise.resolve()
    return (async () => {
      while (!signal.aborted) await sleep(EVERY, signal)
    })()
  }
  // Already aborted means one pass. A live signal also stops an in-flight
  // edge request, so shutdown and a lost lease do not wait on the network.
  let stop = signal.aborted ? undefined : signal
  return polling(host, make(options.pull, stop), options, signal)
}
