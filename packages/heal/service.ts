// One leased heal service follows tracker query answers. Sync owns reconnects;
// each pass reads the present answer again, so neither a failed box write nor
// a failed tracker mark loses work.
//
// A failure is reported at once where it is caught, tagged with its step: the
// read of the box's owed work, opening a tracker, its read by id, a mark, a
// bug's reconcile. The same failure at the same step again, pass after pass
// or bug after bug, is the same bug and is not reported again; the first time
// the step succeeds, a line says so, and a failure after that reports anew.

import {
  type Client,
  client,
  type ClientOpts,
  type Watch,
  WriteRefused,
} from '@yaks/client'
import { sleep } from '@yaks/effects'
import { answered, failing, type Outage } from '@yaks/effects/outage'
import { type Clock, heard } from '@yaks/fp'
import type { Bundle, Graph } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { trackerDoc } from '@yaks/tracker/vocab'
import { type Doors, poll, pollThread } from '@yaks/tracker/poll'
import { type Remote, spaces as listed } from '@yaks/tracker/remote'
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
let followed = '.bug.status=open ?doc ?during ?regressed ?taken'
let named = (eids: string[]) =>
  `.bug .entity.eid=${
    eids.join(',')
  } ?doc ?during ?regressed ?resolved ?archived ?taken`

/** How long a tracker may take to answer a read by id, in ms. */
const ASK = 30_000

/** How the platform tracker is named among the followed trackers. */
export const PLATFORM = 'yaks.app'

/** The service's config and injectable graph and clock doors. */
export type Options = FixOptions & {
  /** Base URLs of tracker graphs; no tracker is followed unless named. */
  trackers?: string[]
  /** The platform tracker Worker, the same `{url, secret}` as
   * @yaks/tracker's own `remote`: polled, and followed before the trackers,
   * and each space's tracker it lists after it. */
  remote?: Remote
  /** The global eids of the spaces whose trackers are followed beside the
   * platform's (default: the platform tracker's list of them), asked each
   * periodic pass. */
  spaces?: () => Promise<string[]>
  /** Time between passes when no tracker answer changed, in ms (default
   * 60000): re-check task marks and gates that open with time (cap, cooldown). */
  every?: number
  /** Open a live tracker query and write door, `scope` naming a space's
   * tracker on yaks.app; defaults to the headless client and the poll. */
  open?: (url: string, scope?: string) => Tracker
  /** Pause between passes; defaults to an abortable sleep. */
  wait?: typeof sleep
  /** The clock passes and failures are timed by (default `Date.now`). */
  now?: () => number
  /** A step that failed succeeding again (default `console.warn`). */
  log?: (line: string) => void
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
  pick(trackerDoc, 'bug', 'during', 'regressed', 'taken', 'resolved'),
], [kernelKeywords])

/** A headless tracker subscription. Closing it releases the whole client. */
export let track = (
  url: string,
  { clock, ...options }: ClientOpts & { clock?: Clock } = {},
): Tracker => {
  let remote = client(vocab, [], {
    ...options,
    url,
    vault: false,
    wireVault: false,
  })
  // Reads by id still unanswered, each failed when the tracker closes.
  let asking = new Set<(error: Error) => void>()
  // A read by id is a watch the server answers, closed at its first answer.
  // One the tracker cannot answer within `ASK` of time this thread could hear
  // it fails, and a later pass asks again.
  let get = (eids: string[]) =>
    new Promise<Bundle[]>((resolve, reject) => {
      let watch = remote.watch(named(eids), { evaluate: 'server' })
      let off = () => {}
      let end = (settle: () => void) => {
        off()
        late()
        asking.delete(fail)
        watch.close()
        settle()
      }
      let fail = (error: Error) => end(() => reject(error))
      let answered = () =>
        watch.refused
          ? fail(new Error(watch.refused))
          : watch.ready && end(() => resolve(watch.value))
      let late = heard(
        ASK,
        () => fail(new Error(`${url} did not answer a read by id in time`)),
        clock,
      )
      asking.add(fail)
      off = watch.subscribe(answered)
      answered()
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
  let trackers = [...new Set(options.trackers ?? [])]
  if (!platform && !trackers.length) return
  // Each space's tracker on yaks.app follows the platform's, keyed by its
  // scope, and joins once the platform lists it.
  let scopes = new Map<string, string>()
  let keyOf = (scope: string) => `${PLATFORM} space ${scope}`
  let list = options.spaces ??
    (() => listed(options.remote!))
  let urls = () => [
    ...platform ? [platform, ...scopes.keys()] : [],
    ...trackers,
  ]
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
  let now = options.now ?? Date.now
  let log = options.log ?? console.warn
  let report = async (error: unknown, step: string) => {
    try {
      let tags = { package: '@yaks/heal', step }
      if (host.report) await host.report(error, { tags })
      else console.error(`@yaks/heal ${step} —`, error)
    } catch { /* a reporting failure cannot stop recovery */ }
  }
  // The failure each step last reported and since when
  // (@yaks/effects/outage), by the step and what it was about (a tracker, a
  // bug), while that step keeps failing; and the failures already told, so
  // one caught again further out is not.
  let failures = new Map<string, Outage>()
  let told = new WeakSet<object>()
  let fail = async (step: string, about: string, error: unknown) => {
    if (told.has(Object(error))) return
    if (Object(error) === error) told.add(error as object)
    let key = `${step} ${about}`
    let { outage, fresh } = failing(failures.get(key), now(), {
      cause: String(error),
    })
    failures.set(key, outage)
    if (fresh) await report(error, step)
  }
  let fine = (step: string, about: string) => {
    let key = `${step} ${about}`, was = failures.get(key)
    let lasted = answered(was, now())
    if (lasted == null) return
    failures.delete(key)
    log(
      `@yaks/heal — ${step} of ${about} succeeds again after ${lasted} ms of ${was?.cause}`,
    )
  }
  // A failed mark is told as the mark's, not its bug's reconcile.
  let marks =
    (url: string, mutate: Tracker['mutate']): Tracker['mutate'] =>
    async (...args) => {
      try {
        let done = await mutate(...args)
        fine('mark', url)
        return done
      } catch (error) {
        await fail('mark', url, error)
        throw error
      }
    }
  // The space trackers' polls share one thread for their signed doors.
  let thread: (Doors & { close: () => void }) | undefined
  let open = options.open ??
    ((url: string, scope?: string) =>
      url == PLATFORM
        ? poll(options.remote!, followed, {
          every: options.every && Math.min(options.every, 30_000),
          report: (error) => void report(error, 'tracker poll'),
          log: options.log,
          ...scope
            ? { scope, doors: thread ??= pollThread(options.remote!) }
            : {},
        })
        : track(url, {
          // A refused mark is the tracker refusing heal's own write: an
          // Error that names the refusal, never its bare body.
          report: (trouble) => {
            void report(
              trouble.refused
                ? new WriteRefused(trouble.sent, trouble.refused)
                : trouble.error,
              'tracker sync',
            )
          },
        }))
  try {
    do {
      let moved = changed()
      let began = now()
      let all = began - whole >= every
      let covered = true
      // A whole pass also asks the trackers after what the box's open work is
      // about, so a bug resolved or archived while no pass heard it, before a
      // restart say, still closes its work.
      let owing: string[] = []
      if (all) {
        try {
          owing = await owed(host.graph)
          fine('owed read', 'the box')
        } catch (error) {
          covered = false
          await fail('owed read', 'the box', error)
        }
      }
      // A bug some tracker answers is asked by id only there, once it leaves.
      owing = owing.filter((eid) =>
        ![...members.values()].some((held) => held.has(eid))
      )
      if (all && platform) {
        try {
          for (let scope of await list()) scopes.set(keyOf(scope), scope)
          fine('space list', PLATFORM)
        } catch (error) {
          covered = false
          await fail('space list', PLATFORM, error)
        }
      }
      for (let name of urls()) {
        if (!once && signal.aborted) return
        let scope = scopes.get(name)
        let url = scope ? PLATFORM : name
        let step = 'open'
        try {
          let watch = watches.get(name)
          if (!watch) {
            watch = open(url, scope)
            watch.subscribe(() => {
              heard.add(name)
              nudge()
            })
            watches.set(name, watch)
          }
          if (watch.refused) {
            watch.close()
            watches.delete(name)
            throw new Error(watch.refused)
          }
          fine('open', name)
          if (!watch.ready) {
            covered = false
            // Until the platform's first poll settles, no other tracker's bug
            // takes a fixer slot; a poll always settles, answered or failed.
            if (name == platform && !once && !heard.has(name)) break
            continue
          }
          let held = new Set(watch.value.map((bug) => bug.entity.eid))
          // A bug that left the answer was resolved or archived: its marks
          // are read by id at once, to close its work. One whose read fails
          // stays a member, so the next pass asks again.
          let left = [...members.get(name) ?? []].filter((eid) =>
            !held.has(eid)
          )
          let asked = [...new Set([...left, ...owing])]
            .filter((eid) => !held.has(eid))
          step = 'read by id'
          let closed = asked.length ? await watch.get(asked) : []
          if (asked.length) fine(step, name)
          step = 'reconcile'
          members.set(name, held)
          for (let eid of left) replayed.delete(`${name} ${eid}`)
          let due = [
            ...watch.value.flatMap((bug) => {
              let key = `${name} ${bug.entity.eid}`
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
              key: `${name} ${bug.entity.eid}`,
              row: undefined,
            })),
          ]
          if (!due.length) continue
          let settle = await reconcile(
            due.map(({ bug }) => bug),
            url,
            marks(name, watch.mutate),
            scope,
          )
          for (let { bug, key, row } of due) {
            if (!once && signal.aborted) return
            try {
              await settle(bug)
              if (row) replayed.set(key, row)
              fine('reconcile', key)
            } catch (error) {
              replayed.delete(key)
              await fail('reconcile', key, error)
            }
          }
        } catch (error) {
          covered = false
          await fail(step, name, error)
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
    thread?.close()
  }
}
