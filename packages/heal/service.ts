// One leased heal service follows tracker query answers. Sync owns reconnects;
// each pass reads the present answer again, so neither a failed box write nor
// a failed tracker mark loses work.

import {
  type Client,
  client,
  type ClientOpts,
  type Watch,
  WriteRefused,
} from '@yaks/client'
import { sleep } from '@yaks/effects'
import type { Graph } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { trackerDoc } from '@yaks/tracker/vocab'
import { poll } from '@yaks/tracker/poll'
import type { Remote } from '@yaks/tracker/remote'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { follow } from './follow.ts'
import type { Options as FixOptions } from './fix.ts'

export { follow, taskEid } from './follow.ts'

/** A tracker answer and its acknowledged write door, on the same client. */
export type Tracker =
  & Pick<Watch, 'query' | 'value' | 'ready' | 'subscribe' | 'close'>
  & { refused?: string; mutate: Client['mutate'] }

/** How the platform tracker is named among the followed trackers. */
export const PLATFORM = 'yaks.app'

/** The service's config and injectable graph and clock doors. */
export type Options = FixOptions & {
  /** Base URLs of tracker graphs; no tracker is followed unless named. */
  trackers?: string[]
  /** The platform tracker Worker, the same `{url, secret}` as
   * @yaks/tracker's own `remote`: polled, and followed before the trackers. */
  remote?: Remote
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
  pick(trackerDoc, 'bug', 'regressed', 'taken', 'resolved'),
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
    // Terminal bugs remain visible so their marks can close existing work.
    let watch = remote.watch(
      '.bug ?doc ?regressed ?resolved ?archived ?taken',
      {
        evaluate: 'server',
      },
    )
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
  // The platform's bugs reach people, so they take fixer slots first. Its
  // answer is keyed and linked as `yaks.app`, since the Worker's address is
  // no page anyone can open.
  let platform = options.remote?.url ? PLATFORM : undefined
  let urls = [
    ...platform ? [platform] : [],
    ...new Set(options.trackers ?? []),
  ]
  if (!urls.length) return
  let once = signal.aborted
  let every = options.every ?? 60_000
  let watches = new Map<string, Tracker>()
  let heard = new Set<string>()
  let reconcile = follow(host.graph, options)
  // Each closed bug's row as its last replay found it. A flood of hits moves
  // one bug's row many times a second; a pass it wakes replays the open bugs,
  // which compete for fixers, and the closed ones whose rows moved, never all
  // of them. The timer's pass replays every bug, for the task marks and gates
  // that move here or with time.
  let replayed = new Map<string, string>()
  let whole = -Infinity
  // A changed answer ends the wait at once; the timer re-checks tasks and gates.
  let nudge = () => {}
  let changed = () => new Promise<void>((wake) => nudge = wake)
  let report = async (error: unknown) => {
    try {
      if (host.report) await host.report(error)
      else console.error(error)
    } catch { /* a reporting failure cannot stop recovery */ }
  }
  let open = options.open ??
    ((url: string) =>
      url == PLATFORM
        ? poll(options.remote!, '.bug', {
          every: options.every && Math.min(options.every, 30_000),
          report: (error) => void report(error),
        })
        : track(url, {
          // A refused mark is the tracker refusing heal's own write: an
          // Error that names the refusal, never its bare body.
          report: (trouble) => {
            void report(
              trouble.refused
                ? new WriteRefused(trouble.sent, trouble.refused)
                : trouble.error,
            )
          },
        }))
  try {
    do {
      let moved = changed()
      let began = Date.now()
      let all = began - whole >= every
      let covered = true
      for (let url of urls) {
        if (!once && signal.aborted) return
        try {
          let watch = watches.get(url)
          if (!watch) {
            watch = open(url)
            let at = url
            watch.subscribe(() => {
              heard.add(at)
              nudge()
            })
            watches.set(url, watch)
          }
          if (watch.refused) {
            watch.close()
            watches.delete(url)
            throw new Error(watch.refused)
          }
          if (!watch.ready) {
            covered = false
            // Until the platform's first poll settles, no other tracker's bug
            // takes a fixer slot; a poll always settles, answered or failed.
            if (url == platform && !once && !heard.has(url)) break
            continue
          }
          for (let bug of watch.value) {
            if (!once && signal.aborted) return
            let key = `${url} ${bug.entity.eid}`
            let row = JSON.stringify(bug)
            let closed = !!(bug.resolved || bug.archived)
            if (!all && closed && replayed.get(key) == row) continue
            try {
              await reconcile(bug, url, watch.mutate)
              if (closed) replayed.set(key, row)
              else replayed.delete(key)
            } catch (error) {
              replayed.delete(key)
              await report(error)
            }
          }
        } catch (error) {
          covered = false
          await report(error)
        }
      }
      if (all && covered) whole = began
      if (signal.aborted) return
      // A flood of hits changes the answer constantly: a second's floor.
      let wait = options.wait ?? sleep
      await Promise.race([
        wait(every, signal),
        moved.then(() => wait(1000, signal)),
      ])
    } while (!signal.aborted)
  } finally {
    for (let watch of watches.values()) watch.close()
  }
}
