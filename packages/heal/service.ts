// One leased heal service follows tracker query answers. Sync owns reconnects;
// each pass reads the present answer again, so a failed box write loses no bug.

import { client, type ClientOpts, type Watch } from '@yaks/client'
import { sleep } from '@yaks/effects'
import type { Graph } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { trackerDoc } from '@yaks/tracker/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { follow } from './follow.ts'
import type { Options as FixOptions } from './fix.ts'

export { follow, taskEid } from './follow.ts'

/** The service's config and injectable graph and clock doors. */
export type Options = FixOptions & {
  /** Base URLs of tracker graphs; no tracker is followed unless named. */
  trackers?: string[]
  /** Time between passes when no tracker answer changed, in ms (default
   * 60000): how soon a gate that opens with time (cap, cooldown) is seen. */
  every?: number
  /** Open a live tracker query; defaults to the headless graph client. */
  open?: (url: string) => Watch
  /** Pause between passes; defaults to an abortable sleep. */
  wait?: typeof sleep
}

let vocab = loadVocab([kernelDoc, docDoc, toolsDoc, trackerDoc], [
  kernelKeywords,
])

/** A headless tracker subscription. Closing it releases the whole client. */
export let track = (url: string, options: ClientOpts = {}): Watch => {
  let remote = client(vocab, [], {
    ...options,
    url,
    vault: false,
    wireVault: false,
  })
  try {
    let watch = remote.watch('.bug.status=open ?doc ?regressed', {
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
  let watches = new Map<string, Watch>()
  let reconcile = follow(host.graph, options)
  // A changed answer ends the wait at once; the timer only re-checks gates.
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
              await reconcile(bug, url)
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
