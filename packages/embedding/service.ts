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
// The same process builds the quantized index (./native.ts): after each pass
// it builds again once enough vectors have changed. A build is a write of its
// own, a few seconds under the write lock, which is why one process makes it
// and every other only reads it.
//
// The config, and the provider and model rows it names, are read on every
// pass (./options.ts). A server whose key or provider has not arrived starts
// up, stores no vectors, reports what it is waiting for once, and keeps
// looking, so the first pass after it appears is the one that embeds and
// nothing has to be restarted. A pass that fails is reported where
// it happens, and its work stays queued for the next look: a machine that
// cannot reach its model has stale vectors, not a broken graph.

import { sleep } from '@yaks/effects'
import type { Graph } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import type { Derived, Driver } from '@yaks/sql'
import { resolved } from './fields.ts'
import { type Options, ready } from './options.ts'
import { drain } from './sweep.ts'
import { build } from './native.ts'

/** How long an empty queue waits before the loop looks again, by default. */
export let AFTER = 3_000

/** What the service reads: the vocabulary, the database, the graph the
 * provider and model rows are read from, and the host's derived columns,
 * through which a body @yaks/blob stores by address is read as its text. */
export type Host = {
  vocab: Vocab
  sql: Driver
  graph: Pick<Graph, 'get'>
  derived?: Derived
}

/** Settle the queue for as long as `signal` lets it: one pass when it has
 * already aborted, the way a one-shot command runs a service. */
export let service = async (
  host: Host,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  let after = options.after ?? AFTER
  // Reported once per distinct message: a server waiting for a key says so on
  // the first pass and then goes quiet; `vector_check` keeps the answer.
  let told = new Set<string>()
  for (;;) {
    try {
      let now = await ready(host.vocab, options, host.graph)
      if (now.embedder) {
        let text = resolved(now.text, host.derived)
        let done = await drain(host.sql, text, now.embedder, {
          batch: options.batch,
          signal,
        })
        for (let r of done.refused) {
          console.warn('@yaks/embedding refused', r.entity, '—', r.error)
        }
      } else {
        if (!told.has(now.waiting!)) {
          told.add(now.waiting!)
          console.warn('@yaks/embedding —', now.waiting)
        }
        // The vectors already stored are still searched, through an index.
        build(host.sql)
      }
    } catch (error) {
      // A pass the host ended mid-way wrote nothing it had not settled: its
      // work is still queued, and the store it would report into is closing.
      if (signal.aborted) return
      console.warn('@yaks/embedding sweep —', error)
    }
    if (signal.aborted) return
    await sleep(after, signal)
    if (signal.aborted) return
  }
}
