// The work this package keeps doing while a process is up: the `service`
// export (`@yaks/embedding/service`), a loop that settles what the queue
// holds (./owed.ts), run by one process per graph (@yaks/cli holds it under a
// lease). "The server" here means whichever process holds it.
//
// It is a loop rather than an effect because the writes it answers are not
// only this process's. The queue's triggers note every write to embedded text
// in the same statement as the write, whoever made it — this server, a CLI, a
// restore — so the loop reads the queue, not the commits it happened to see.
// While work is left it takes the next batch at once (./sweep.ts `drain`),
// which is how a backfill drains; when the queue is empty it looks again after
// `after`, which is how soon a new entry is found by its meaning. An empty
// look costs a few index reads. A host with nothing standing between requests
// (a Durable Object sleeps) runs `drain` itself when a write asks, and no loop
// at all.
//
// Embedding is slow and usually remote, and a pass never holds a write open:
// what it reads and writes are a batch's rows, and the wait between is the
// model's.
//
// Native search scans canonical vectors; no index maintenance holds a write.
//
// The config, and the provider and model rows it names, are read on every
// pass (./options.ts). A server whose key or provider has not arrived starts
// up, stores no vectors, reports what it is waiting for once, and keeps
// looking, so the first pass after it appears is the one that embeds and
// nothing has to be restarted. A pass that fails leaves its work queued for
// the next look: a machine that cannot reach its model has stale vectors, not
// a broken graph. What its failure is comes from ./outage.ts, as it does for a
// yaks.app store's drains: a model out for a while is a line in the log when
// it starts and when it ends, texts it holds up past OVERDUE report once, and
// any other failure reports at once to the host's tracker, once while passes
// keep failing by it, with a line when one answers again.

import { sleep } from '@yaks/effects'
import type { Graph } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { type Derived, type Statements, statements } from '@yaks/sql'
import { resolved } from './fields.ts'
import { type Lent, type Options, ready } from './options.ts'
import { drain } from './sweep.ts'
import { drained, failed, type Outage, Overdue, type Ride } from './outage.ts'
import { prepare } from './native.ts'

/** How long an empty queue waits before the loop looks again, by default. */
export let AFTER = 3_000

/** What the service reads: the vocabulary, the database, the graph the
 * provider and model rows are read from, and the host's derived columns,
 * through which a body @yaks/blob stores by address is read as its text. */
export type Host = {
  vocab: Vocab
  storage: { statements?: Statements }
  graph: Pick<Graph, 'get'>
  derived?: Derived
  /** the embedders lent by name (@yaks/host `embedders`) */
  embedders?: Lent
  /** where a failed pass is reported (@yaks/host `report`; default
   * `console.error`) */
  report?: (
    error: unknown,
    context: { tags: Record<string, string> },
  ) => void | Promise<void>
}

/** Settle the queue for as long as `signal` lets it: one pass when it has
 * already aborted, the way a one-shot command runs a service. */
export let service = async (
  host: Host,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  let db = statements(host.storage)
  let after = options.after ?? AFTER
  // Reported once per distinct message: a server waiting for a key says so on
  // the first pass and then goes quiet; `vector_check` keeps the answer.
  let told = new Set<string>()
  let now = options.now ?? Date.now
  let outage: Outage | null = null
  let ride = async (made: Ride) => {
    let rode = made(outage, now())
    outage = rode.outage
    if (rode.log) console.warn('@yaks/embedding —', rode.log)
    if (!rode.report) return
    // What varies across one outage (the model, how many texts, how many
    // tries, how long they waited) is the occurrence's, not the bug's.
    let context = rode.report instanceof Overdue ? rode.report.context : {}
    let tags = {
      package: '@yaks/embedding',
      step: 'embedding pass',
      ...context,
    }
    try {
      if (host.report) await host.report(rode.report, { tags })
      else console.error('@yaks/embedding pass —', rode.report)
    } catch (error) {
      console.error('@yaks/embedding report —', error)
    }
  }
  for (;;) {
    try {
      let is = await ready(host.vocab, options, host.graph, host.embedders)
      if (is.embedder) {
        let text = resolved(is.text, host.derived)
        let done = await drain(db, text, is.embedder, {
          batch: options.batch,
          signal,
        })
        // A text the model will not take is the text's, not the pass's: it
        // has no vector, and ranks by its words alone.
        for (let r of done.refused) {
          console.warn('@yaks/embedding refused', r.entity, '—', r.error)
        }
        await ride(drained)
      } else {
        if (!told.has(is.waiting!)) {
          told.add(is.waiting!)
          console.warn('@yaks/embedding —', is.waiting)
        }
        // Native scans still search the vectors already stored.
        prepare(db)
      }
    } catch (error) {
      // A pass the host ended mid-way wrote nothing it had not settled: its
      // work is still queued, and the store it would report into is closing.
      if (signal.aborted) return
      await ride(failed(error))
    }
    if (signal.aborted) return
    await sleep(after, signal)
    if (signal.aborted) return
  }
}
