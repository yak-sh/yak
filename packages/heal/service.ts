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
import type { Bundle, Graph } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { trackerDoc } from '@yaks/tracker/vocab'
import { poll } from '@yaks/tracker/poll'
import type { Remote } from '@yaks/tracker/remote'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { follow, owed } from './follow.ts'
import type { Options as FixOptions } from './fix.ts'

export { follow, taskEid } from './follow.ts'

/** A tracker's open bugs, its acknowledged write door, and a read of any of
 * its bugs by id, on the same client. */
export type Tracker =
  & Pick<Watch, 'query' | 'value' | 'ready' | 'subscribe' | 'close'>
  & {
    refused?: string
    mutate: Client['mutate']
    /** the bugs among `eids`, whatever their marks, asked once */
    get: (eids: string[]) => Promise<Bundle[]>
  }

// A tracker answers its open bugs, carrying what reconciling one reads, so
// the answer costs what its open bugs cost. A resolved or archived bug is
// asked for by id while work here is still open about it (`owed`).
let followed = '.bug.status=open ?doc ?regressed ?taken'
let named = (eids: string[]) =>
  `.bug .entity.eid=${
    eids.join(',')
  } ?doc ?regressed ?resolved ?archived ?taken`

/** How long a tracker may take to answer a read by id, in ms. */
const ASK = 30_000

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
  pick(kernelDoc, 'entity', 'resolved', 'archived'),
  provenanceDoc,
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
  // Reads by id still unanswered, each failed when the tracker closes.
  let asking = new Set<(error: Error) => void>()
  // A read by id is a watch the server answers, closed at its first answer.
  // One the tracker cannot answer within `ASK` fails, and a later pass asks
  // again.
  let get = (eids: string[]) =>
    new Promise<Bundle[]>((resolve, reject) => {
      let watch = remote.watch(named(eids), { evaluate: 'server' })
      let off = () => {}
      let end = (settle: () => void) => {
        off()
        clearTimeout(late)
        asking.delete(fail)
        watch.close()
        settle()
      }
      let fail = (error: Error) => end(() => reject(error))
      let heard = () =>
        watch.refused
          ? fail(new Error(watch.refused))
          : watch.ready && end(() => resolve(watch.value))
      let late = setTimeout(
        () => fail(new Error(`${url} did not answer a read by id in time`)),
        ASK,
      )
      asking.add(fail)
      off = watch.subscribe(heard)
      heard()
    })
  try {
    let watch = remote.watch(followed, { evaluate: 'server' })
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
      get: (eids) => eids.length ? get(eids) : Promise.resolve([]),
      close: () => {
        for (let fail of asking) fail(new Error(`${url} closed`))
        remote.close()
      },
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
  // A changed tracker answer only replays the rows that moved. Local task
  // and lifecycle changes, and time-based gates, are retried by the bounded
  // periodic pass. Replaying every open bug for each new hit made cap checks
  // spend the whole worker on the same fixer transcripts.
  let replayed = new Map<string, string>()
  // The open bugs each tracker answered at its last pass.
  let members = new Map<string, Set<string>>()
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
        ? poll(options.remote!, followed, {
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
      // A whole pass also asks the trackers after what the box's open work is
      // about, so a bug resolved or archived while no pass heard it, before a
      // restart say, still closes its work.
      let owing: string[] = []
      if (all) {
        try {
          owing = await owed(host.graph)
        } catch (error) {
          covered = false
          await report(error)
        }
      }
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
          let held = new Set(watch.value.map((bug) => bug.entity.eid))
          // A bug that left the answer was resolved or archived: its marks
          // are read by id at once, to close its work. One whose read fails
          // stays a member, so the next pass asks again.
          let left = [...members.get(url) ?? []].filter((eid) => !held.has(eid))
          let asked = [...new Set([...left, ...owing])]
            .filter((eid) => !held.has(eid))
          let closed = asked.length ? await watch.get(asked) : []
          members.set(url, held)
          for (let eid of left) replayed.delete(`${url} ${eid}`)
          let due = [
            ...watch.value.flatMap((bug) => {
              let key = `${url} ${bug.entity.eid}`
              // Occurrence counts and last-seen timestamps change on every
              // hit; they do not change the work or a fixer gate. A
              // regression, mark or changed evidence does, and the periodic
              // pass retries gates.
              let row = JSON.stringify([
                (bug.bug as Record<string, unknown>).fault,
                bug.doc,
                bug.regressed,
                bug.taken,
              ])
              return all || replayed.get(key) != row ? [{ bug, key, row }] : []
            }),
            ...closed.map((bug) => ({
              bug,
              key: `${url} ${bug.entity.eid}`,
              row: undefined,
            })),
          ]
          if (!due.length) continue
          let settle = await reconcile(
            due.map(({ bug }) => bug),
            url,
            watch.mutate,
          )
          for (let { bug, key, row } of due) {
            if (!once && signal.aborted) return
            try {
              await settle(bug)
              if (row) replayed.set(key, row)
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
