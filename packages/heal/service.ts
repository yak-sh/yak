// One leased heal service follows tracker query answers. Sync owns reconnects;
// each pass reads the present answer again, so neither a failed box write nor
// a failed tracker mark loses work.

import { type Client, client, type ClientOpts, type Watch } from '@yaks/client'
import { sleep } from '@yaks/effects'
import type { Graph } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { trackerDoc } from '@yaks/tracker/vocab'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { follow } from './follow.ts'
import type { Options as FixOptions } from './fix.ts'

export { follow, taskEid } from './follow.ts'

/** A tracker answer and its acknowledged write door, on the same client. */
export type Tracker = Watch & { mutate: Client['mutate'] }

/** The service's config and injectable graph and clock doors. */
export type Options = FixOptions & {
  /** Base URLs of tracker graphs; no tracker is followed unless named. */
  trackers?: string[]
  /** Time between passes when no tracker answer changed, in ms (default
   * 60000): re-check task marks and gates that open with time (cap, cooldown). */
  every?: number
  /** Open a live tracker query and write door; defaults to the headless client. */
  open?: (url: string) => Tracker
  /** Pause between passes; defaults to an abortable sleep. */
  wait?: typeof sleep
}

// The replica holds the follower's answer and marks, never tracker intake,
// tools, mail or effects. Their declarations belong to the tracker host.
let pick = (doc: VocabDoc, ...names: string[]): VocabDoc => ({
  $defs: Object.fromEntries(names.map((name) => [name, doc.$defs![name]])),
})
let vocab = loadVocab([
  pick(kernelDoc, 'entity', 'created', 'updated', 'resolved', 'archived'),
  pick(docDoc, 'doc'),
  pick(trackerDoc, 'bug', 'regressed'),
], [kernelKeywords])

/** A headless tracker subscription. Closing it releases the whole client. */
export let track = (url: string, options: ClientOpts = {}): Tracker => {
  let remote = client(vocab, [], {
    ...options,
    url,
    vault: false,
    wireVault: false,
  })
  try {
    // Resolved bugs remain visible so cancelling their work can archive them.
    let watch = remote.watch('.bug !archived ?doc ?regressed ?resolved', {
      evaluate: 'server',
    })
    return {
      get query() {
        return watch.query
      },
      get value() {
        return watch.value
      },
      get ready() {
        return watch.ready
      },
      get refused() {
        return watch.refused
      },
      subscribe: watch.subscribe,
      mutate: remote.mutate,
      close: () => remote.close(),
    }
  } catch (error) {
    remote.close()
    throw error
  }
}

/** Follow named trackers until shutdown, or take one pass with an aborted signal. */
export let service = async (
  host: { graph: Graph } & Pick<Host, 'report'>,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  let urls = [...new Set(options.trackers ?? [])]
  if (!urls.length) return
  let once = signal.aborted
  let watches = new Map<string, Tracker>()
  let reconcile = follow(host.graph, options)
  // A changed answer ends the wait at once; the timer re-checks tasks and gates.
  let nudge = () => {}
  let changed = () => new Promise<void>((wake) => nudge = wake)
  let report = async (error: unknown) => {
    try {
      if (host.report) await host.report(error)
      else console.error(error)
    } catch { /* a reporting failure cannot stop recovery */ }
  }
  let open = options.open ?? ((url: string) =>
    track(url, {
      report: (trouble) => {
        void report(trouble.error ?? trouble.refused)
      },
    }))
  try {
    do {
      let moved = changed()
      for (let url of urls) {
        if (!once && signal.aborted) return
        try {
          let watch = watches.get(url)
          if (!watch) {
            watch = open(url)
            watch.subscribe(() => nudge())
            watches.set(url, watch)
          }
          if (watch.refused) {
            watch.close()
            watches.delete(url)
            throw new Error(watch.refused)
          }
          if (!watch.ready) continue
          for (let bug of watch.value) {
            if (!once && signal.aborted) return
            try {
              await reconcile(bug, url, watch.mutate)
            } catch (error) {
              await report(error)
            }
          }
        } catch (error) {
          await report(error)
        }
      }
      if (signal.aborted) return
      // A flood of hits changes the answer constantly: a second's floor.
      let wait = options.wait ?? sleep
      await Promise.race([
        wait(options.every ?? 60_000, signal),
        moved.then(() => wait(1000, signal)),
      ])
    } while (!signal.aborted)
  } finally {
    for (let watch of watches.values()) watch.close()
  }
}
