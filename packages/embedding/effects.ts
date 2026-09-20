// What a host DOES about text that moved: the `effects` facet
// (`@yaks/embedding/effects`) — one watch per embedded component, each nudging
// the sweep a moment after the batch commits.
//
// Embedding is slow and remote; a write is neither. So no handler here embeds
// anything: a write starts a timer and returns, and the sweep runs on its own
// once the burst has settled. Nothing is awaited into `apply()` — a graph that
// waited on a model to answer before it could say a title changed would be a
// graph nobody could write to.
//
// The sweep reconciles the WHOLE corpus rather than the entity that woke it,
// which is what makes a model change heal itself: the vectors are all stale
// under the new model's name, and the first write after the change drains them
// (`sweep.ts` decides "stale" by a content hash, so an unchanged corpus costs
// one query and no embedder calls). What this facet does NOT have is a clock —
// an effects facet is a list of watches and owns no lifecycle, so a host that
// wants a reconciliation on a schedule rather than on a write calls `sweep()`
// from a wake (@yaks/wake) or a cron.

import type { Watch } from '@yaks/effects'
import type { Vocab } from '@yaks/vocab'
import type { Driver } from './driver.ts'
import type { Field } from './fields.ts'
import { chosen, embedderOf, type Options } from './options.ts'
import { sweep } from './sweep.ts'

/** How long a burst of writes settles before one sweep answers all of it. */
export let AFTER = 3_000

// The handler a watch fires: it starts nothing and returns nothing, so the
// commit that woke it is never held open. A failure is reported where it
// happens — a write that already landed cannot be failed by an embedder that
// is unreachable, and a graph whose box cannot reach its model is a graph with
// stale vectors, not a broken one.
let nudge = (
  run: () => Promise<unknown>,
  ms: number,
  report: (error: unknown) => void,
): () => void => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return () => {
    clearTimeout(timer)
    timer = setTimeout(() => void run().catch(report), ms)
  }
}

// The components those fields live on, each with the columns watched on it:
// an entity's vector is made of every field it wears, so any of them moving is
// the same news.
let watched = (text: Field[]): Map<string, string[]> => {
  let by = new Map<string, string[]>()
  for (let f of text) by.set(f.comp, [...by.get(f.comp) ?? [], f.prop])
  return by
}

/** The watches that keep the vectors true: a component gained, one of its
 * embedded columns patched, or the component gone — each a reason to
 * reconcile. */
export let effects = (
  host: { vocab: Vocab; sql: Driver },
  options: Options = {},
): Watch[] => {
  let text = chosen(host.vocab, options)
  let embedder = embedderOf(options)
  let soon = nudge(
    () => sweep(host.sql, text, embedder, options.batch),
    options.after ?? AFTER,
    (error) => console.warn('@yaks/embedding sweep —', error),
  )
  return [...watched(text)].map(([comp, props]) => ({
    comp,
    created: soon,
    changed: Object.fromEntries(props.map((prop) => [prop, soon])),
    removed: soon,
    doc: `re-embed what moved: ${comp}.${props.join(', ')}`,
  }))
}
