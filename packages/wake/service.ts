// The clock: the `service` facet a host takes (`@yaks/wake/service`). Without
// it a graph knows perfectly well what is due and nobody ever asks — the
// wakes sit there, and `fired` is a stamp no host writes.
//
// It is a SERVICE rather than an effect because nothing commits when an
// instant arrives. A wake comes due by the passage of time, which no batch
// reports, so the only thing that can notice is something running.
//
// `loop` (./deno.ts) sleeps until the next due instant rather than beating at
// a fixed rate, so an idle graph costs one timer and a wake written a second
// from now is not waited out to the cap.

import type { Graph } from '@yaks/graph'
import { loop } from './deno.ts'
import type { Ticked } from './tick.ts'

/** What a config says to this plugin. */
export type Options = {
  /** the longest this may sleep, in milliseconds (default one minute) — also
   * how soon a refused wake is tried again */
  cap?: number
}

/** Fire what is due, for as long as the host is up. */
export let service = (
  host: { graph: Graph },
  options: Options = {},
  signal?: AbortSignal,
): Promise<void> =>
  loop(host.graph, {
    signal,
    ...options.cap ? { cap: options.cap } : {},
    // A wake whose own batch was refused is the one thing here worth saying
    // out loud: it stays due, so a host that never says it loops in silence.
    onTick: ({ refused }: Ticked) => {
      for (let { wake, error } of refused) {
        console.error('wake refused —', wake.entity?.eid, error)
      }
    },
  })
