// The drain a host with nothing standing between requests runs: a Durable
// Object, which sleeps. The service (./service.ts) is a loop that looks
// again; this has no loop. It drains once a write has committed and when its
// alarm rings, a batch at a time, waiting on the model between batches, so
// requests interleave and none waits on it. It drains for a slice
// (`deadline`) and arms the alarm for the rest, so a store that owes a
// vector for every text it holds catches up behind its own traffic.
//
// The embedder asks again through a passing failure of the model's own
// (./remote.ts `retrying`). A drain that fails even so comes back `retry` ms
// later, and nothing else starts one meanwhile. A model that did not answer
// is an outage the drains ride out (./outage.ts), kept by the host, since it
// outlives the incarnations its retries wake.
//
// What the host does is handed in: its clock, its alarm, how it holds work
// past a request (`waitUntil`), where it keeps the outage and reports. The
// app stores and the Operator's store on yaks.app run it the same way.

import type { Bundle } from '@yaks/graph'
import type { Statements } from '@yaks/sql'
import { type Clock, system } from '@yaks/fp'
import type { Embedder } from './embedder.ts'
import type { Field } from './fields.ts'
import { BATCH, drain, type Drained } from './sweep.ts'
import { due, owing, queues } from './owed.ts'
import { drained, failed, type Outage, Overdue, type Ride } from './outage.ts'

/** What a sleeping host lends its drains. */
export type Sleeping = {
  /** its texts, or null while it can drain nothing: no schema standing yet,
   * or asleep for good */
  texts: () => { statements: Statements; fields: Field[] } | null
  /** the embedder, or null where none is lent */
  model: () => Embedder | null
  /** sets the host's alarm, for the rest of a drain or its retry */
  arm: (at: number, why: string) => Promise<void>
  /** keeps the host up until the work is done (`waitUntil`) */
  hold?: (work: Promise<unknown>) => void
  /** where the outage the drains are riding out is kept */
  outage: { get: () => Outage | null; set: (o: Outage | null) => void }
  /** where a failure goes, with what varies across one outage */
  report: (error: unknown, context: Record<string, unknown>) => void
  /** a line for the log */
  log?: (line: string, ...detail: unknown[]) => void
  clock?: Clock
  /** how long one drain may run, in ms */
  deadline?: number
  /** how long a failed drain waits, in ms, given its error */
  retry?: (error: unknown) => number
  /** when the alarm rings for the rest of a drain */
  soon?: () => number
}

/** A sleeping host's drains. */
export type Sleeper = {
  /** what a committed write calls: a drain where it queued a text */
  wrote: (bundles: Bundle[]) => Bundle[]
  /** a drain, unless one runs or a failed one waits */
  run: () => void
  /** whether a text is owed its vector: one queued row sought */
  owes: () => boolean
  /** when a failed drain is retried, if one waits */
  retry: () => number | null
  /** the drain in flight */
  work: () => Promise<void> | null
}

/** How long a drain runs before the alarm takes up the rest. */
export let DEADLINE = 10_000

/** How long a failed drain waits. */
export let RETRY = 60_000

/** The drains of a host that sleeps between requests. */
export let sleeper = (host: Sleeping): Sleeper => {
  let clock = host.clock ?? system
  let log = host.log ?? ((line, ...detail) => console.warn(line, ...detail))
  let work: Promise<void> | null = null
  let again = false
  let waits = 0

  let ride = (ride: Ride) => {
    let was = host.outage.get()
    let { outage, report, log: line } = ride(was, clock.now())
    if (outage != was) host.outage.set(outage)
    if (line) log('embedding', line)
    // What varies across one outage (the model, how many texts, how many
    // tries, how long they waited) is the occurrence's, not the bug's.
    if (report) {
      host.report(report, report instanceof Overdue ? report.context : {})
    }
  }

  let owes = () => {
    let texts = host.texts()
    return !!texts && owing(texts.statements)
  }

  let run = () => {
    let model = host.model()
    let texts = host.texts()
    if (!texts || !model) return
    if (clock.now() < waits) return
    if (work) {
      if (owes()) again = true
      return
    }
    // Keep the batch that proves work is owed; the drain need not read it
    // again. Queue generations still protect writes made while the model
    // runs.
    let queued: ReturnType<typeof due> | undefined = due(
      texts.statements,
      BATCH,
    )
    // Nothing owed waits on the model, whether or not it answers.
    if (!queued.length && !owes()) return ride(drained)
    work = (async () => {
      do {
        again = false
        let now = host.texts()
        if (!now) return
        let deadline = new AbortController()
        let cancel = clock.after(
          host.deadline ?? DEADLINE,
          () => deadline.abort(new DOMException('timed out', 'TimeoutError')),
        )
        let done: Drained = await drain(now.statements, now.fields, model, {
          signal: deadline.signal,
          queued,
        }).finally(cancel)
        queued = undefined
        if (!host.texts()) return
        // A text the model will not take is the text's, not the host's: it
        // has no vector, and ranks by its words alone.
        for (let r of done.refused) {
          log('embed refused', r.entity, r.error.message)
        }
      } while (again)
      ride(drained)
      if (owes()) await host.arm(host.soon?.() ?? clock.now(), 'embedding')
    })().catch(async (error) => {
      ride(failed(error))
      waits = clock.now() + (host.retry?.(error) ?? RETRY)
      await host.arm(waits, 'embedding retry')
        .catch((e) => host.report(e, { request: 'embedding retry' }))
    }).finally(() => {
      work = null
      if (again) run()
    })
    host.hold?.(work)
  }

  return {
    wrote: (bundles) => {
      // Its triggers queued the text in the write's own statement, so this
      // asks only of a write that names what a trigger watches.
      let texts = host.texts()
      if (texts && queues(texts.fields, bundles)) run()
      return bundles
    },
    run,
    owes,
    retry: () => waits > clock.now() ? waits : null,
    work: () => work,
  }
}
