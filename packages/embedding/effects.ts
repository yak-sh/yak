// What the server does about text that changed: the `effects` export
// (`@yaks/embedding/effects`) — one watch per embedded component, each
// scheduling a sweep a moment after the write commits. "The server" here means
// whichever process opened the graph and loaded this package.
//
// Embedding is slow and usually remote; a write is neither. So no handler here
// embeds anything: a write starts a timer and returns, and the sweep runs on
// its own once the burst of writes has settled. Nothing is awaited inside
// `apply()` — a graph that waited for a model to respond before it could record
// that a title changed would be a graph nobody could write to.
//
// The sweep reconciles the whole corpus rather than the one entity that
// triggered it, which is what makes a model change repair itself: under the new
// model's name every vector is stale, and the first write after the change
// starts re-embedding them (`sweep.ts` decides "stale" from a content hash, so
// an unchanged corpus costs one query and no calls to the embedder). What this
// export does not have is a clock — it is a list of watches and owns no
// lifecycle, so a server that wants to reconcile on a schedule rather than on a
// write calls `sweep()` from a wake (@yaks/wake) or from cron.
//
// The config is read on every pass, never once when the plugin is composed
// (./options.ts). A server whose key has not arrived starts up, stores no
// vectors, reports what it is waiting for once, and keeps the timer running —
// so the first pass after the key appears is the one that embeds, and nothing
// has to be restarted.
//
// Every timer here is cancelled when the server shuts down (@yaks/cli
// `Host.stopping`), because a callback that fires after the database is closed
// is a stack trace about nothing, and a pending timer keeps the process alive.

import type { Watch } from '@yaks/effects'
import type { Vocab } from '@yaks/vocab'
import type { Driver } from './driver.ts'
import { type Field, resolved } from './fields.ts'
import { type Options, ready } from './options.ts'
import { sweep } from './sweep.ts'

/** How long a burst of writes settles before one sweep answers all of it. */
export let AFTER = 3_000

/** How long a pass that did nothing waits before looking again, when the
 * settle delay is zero — a delay of zero would spin, for a server whose only
 * remaining work is to re-read its config. */
export let AGAIN = 1_000

// The handler a watch calls: it starts a timer and returns, so the commit that
// triggered it is never held open. A burst of writes produces one sweep — the
// timer is reset, never stacked — and one pass runs at a time, because a pass
// may be a long series of model calls and a second one over the same backlog
// would pay for every vector twice. A request that arrives mid-pass is
// remembered and runs when that pass is over rather than being dropped: the
// writes it was about would otherwise stay stale until something else changed.
//
// A pass that asks for another one gets it after the same delay: that is how a
// server waiting for config keeps checking, cheaply, until the config arrives.
//
// A failure is reported where it happens. A write that has already committed
// cannot be failed by an embedder nobody can reach, and a machine that cannot
// reach its model has stale vectors, not a broken write.
let nudge = (
  run: () => Promise<boolean>,
  ms: number,
  report: (error: unknown) => void,
  stopping?: AbortSignal,
): () => void => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let busy = false
  let again = false
  let arm = (wait: number): void => {
    if (stopping?.aborted) return
    clearTimeout(timer)
    timer = setTimeout(go, wait)
  }
  let go = async (): Promise<void> => {
    if (busy) return void (again = true)
    busy = true
    let more = false
    try {
      more = await run()
    } catch (error) {
      report(error)
    }
    busy = false
    if (again) {
      again = false
      await go()
    } else if (more) arm(ms || AGAIN)
  }
  // The server shutting down is what stops this: the pending timer is dropped
  // rather than firing into a closed store.
  stopping?.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return () => arm(ms)
}

// The components those fields live on, each with the properties watched on it:
// an entity's vector is made from all of its text fields, so a change to any of
// them means the same thing.
let watched = (text: Field[]): Map<string, string[]> => {
  let by = new Map<string, string[]>()
  for (let f of text) by.set(f.comp, [...by.get(f.comp) ?? [], f.prop])
  return by
}

/** The watches that keep the vectors in step with the text: a component added,
 * one of its embedded properties patched, or the component removed — each is a
 * reason to reconcile. A server with no embedder yet still registers them:
 * what it is missing is the model, not the notifications. */
export let effects = (
  host: {
    vocab: Vocab
    sql: Driver
    stopping?: AbortSignal
    derived?: Record<string, { text?: (stored: string) => string }>
  },
  options: Options = {},
): Watch[] => {
  // Which components to watch follows from the `text` option, and that is a
  // fact about the vocabulary rather than a secret that arrives late.
  let { text } = ready(host.vocab, options)
  // Reported once per distinct message: a server waiting for a key reports it
  // on the first pass and then goes quiet, and `vector_check` is where the
  // answer stays available.
  let told = new Set<string>()
  let pass = async (): Promise<boolean> => {
    let now = ready(host.vocab, options)
    if (!now.embedder) {
      if (!told.has(now.waiting!)) {
        told.add(now.waiting!)
        console.warn('@yaks/embedding —', now.waiting)
      }
      // Look again after the next delay: the config may be one export away.
      return true
    }
    // A body @yaks/blob stores by address is read as its text, the way the
    // store reads it (the host's derived columns).
    let text = resolved(now.text, host.derived)
    await sweep(host.sql, text, now.embedder, options.batch)
    return false
  }
  let soon = nudge(
    pass,
    options.after ?? AFTER,
    (error) => console.warn('@yaks/embedding sweep —', error),
    host.stopping,
  )
  return [...watched(text)].map(([comp, props]) => ({
    comp,
    created: soon,
    changed: Object.fromEntries(props.map((prop) => [prop, soon])),
    removed: soon,
    doc: `re-embed what moved: ${comp}.${props.join(', ')}`,
  }))
}
