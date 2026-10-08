// The inbox's letters, as a duty: the module a server imports at
// `@yaks/inbox/service`. Every pass reads the person's inbox and queues a
// letter for each newly blocking decision, and after `hour` (UTC) at most one
// digest a day of the rest (./letters.ts). The queued letters are the record:
// their eids are derived from what they render, so a pass that finds them
// written queues nothing, and a missed day is not replayed. @yaks/mail sends
// them.
//
// It is a loop because nothing is committed when a day turns or a thread waits;
// it is a duty so that one process over the graph queues at a time. A config
// that opens no door (./options.ts) has nothing to queue, and the duty ends at
// once.

import type { Graph } from '@yaks/graph'
import { sleep } from '@yaks/fp'
import { queue } from './letters.ts'
import { door, type Options } from './options.ts'

/** How long a pass waits for the next one, unless the config says. */
export let EVERY = 10_000

/** Queue what is owed, then again every `every`, until the signal aborts. An
 * already-aborted signal is one pass. */
export let service = async (
  host: { graph: Graph },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  let open = door(options)
  if (!open) return
  for (;;) {
    let now = new Date().toISOString()
    await queue(
      host.graph,
      host.graph.vocab,
      open,
      (b) => host.graph.apply(b),
      now,
      new Date(now).getUTCHours() >= (open.hour ?? 9),
    )
    if (signal.aborted) return
    await sleep(open.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}
