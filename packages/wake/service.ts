// The clock: the module a server imports at `@yaks/wake/service` to run this
// package's background loop for as long as the server is up. Without it the
// graph still knows perfectly well what is due and nothing ever asks — the
// wakes sit there, and no process writes `fired`.
//
// It is a long-running loop rather than an effect because nothing is committed
// when an instant arrives. A wake becomes due through the passage of time,
// which no write reports, so only running code can notice.
//
// `loop` (./deno.ts) sleeps until the next due instant rather than polling at a
// fixed rate, so an idle graph costs one timer, and a wake written a second
// from now is not made to wait out the cap.

import type { Graph } from '@yaks/graph'
import { loop } from './deno.ts'
import type { Ticked } from './tick.ts'

/** What a config file can set for this plugin. */
export type Options = {
  /** the longest this may sleep, in milliseconds (default one minute) — also
   * how soon a wake whose transaction was rejected is retried */
  cap?: number
}

/** Fire what is due, for as long as the server is up. */
export let service = (
  host: { graph: Graph },
  options: Options = {},
  signal?: AbortSignal,
): Promise<void> =>
  loop(host.graph, {
    signal,
    ...options.cap ? { cap: options.cap } : {},
    // A wake whose own transaction was rejected is the one thing here worth
    // logging: it stays due, so a server that never reports it loops in
    // silence.
    onTick: ({ refused }: Ticked) => {
      for (let { wake, error } of refused) {
        console.error('wake refused —', wake.entity?.eid, error)
      }
    },
  })
