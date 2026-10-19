// Immediate builders are a transaction rule, not an effect for every edit.
// Dependencies narrow the builders; reconciliation over the pending batch
// writes calls only for inputs that really changed or entered the selection.
import type { Bundle, Comp, Hook } from '@yaks/graph'
import { comps, dead } from '@yaks/graph/bundle'
import { guard } from '@yaks/graph/guard'
import { resolve } from '@yaks/graph/identity'
import { after, each } from '@yaks/fp'
import { and, eq, list } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { step, steps } from './steps.ts'
import { type Options, reconcile } from './build.ts'

/** What an input write's reconciliation answers in place, and who hears an
 * in-place answer that threw (./code.ts). */
export type Here = Pick<Options, 'tools' | 'report'>

export let changing = (vocab: Vocab, here: Here = {}): Hook =>
(
  bundles,
  tx,
) => {
  if (!vocab.comp('builder_dep')) return bundles
  let changes = bundles.filter((b) =>
    !b.effect && !b.builder_dep && !b.build && !b.call && !b.result &&
    !b.execution && !b.interrupted && !b.failed && !b.refusal &&
    !(b.output as Comp | undefined)?.value
  )
  if (!changes.length) return bundles
  // Component selections repeat across writes, so keep their scalar queries
  // reusable in storage. Entity selections are mostly empty and unique: batch
  // those probes instead of paying one storage operation per changed entity.
  // Keep each any-of below the host's bind limit, including query overhead.
  let entities = [...new Set(changes.map((b) => `entity:${b.entity.eid}`))]
  let sources = [
    ...new Set([
      'component:*',
      ...changes.flatMap((b) => comps(b).map(([name]) => `component:${name}`)),
    ]),
  ].map((source) => eq('builder_dep.source', source))
  for (let i = 0; i < entities.length; i += 64) {
    let group = entities.slice(i, i + 64)
    sources.push(
      eq('builder_dep.source', group.length == 1 ? group[0] : list(...group)),
    )
  }
  return after(
    each(
      sources,
      [] as Bundle[],
      (deps, source) =>
        after(tx.read(and(source)), (found) => {
          deps.push(...found)
          return deps
        }),
    ),
    (deps) => deps.length ? apply(bundles, tx, vocab, deps, here) : bundles,
  )
}

let apply = (
  bundles: Bundle[],
  tx: Parameters<Hook>[1],
  vocab: Vocab,
  deps: Bundle[],
  here: Here,
) =>
  steps(function* () {
    let builders = (yield* step(tx.get([
      ...new Set(deps.map((b) => String((b.builder_dep as Comp).builder))),
    ]))).filter((b) =>
      (b.builder as Comp)?.immediate && !b.staged && !b.archived &&
      !bundles.some((write) =>
        write.entity.eid == b.entity.eid && write.builder
      )
    )
    if (!builders.length) {
      return bundles
    }
    let writes: Bundle[] = []
    for (let builder of builders) {
      writes.push(
        ...(yield* step(
          reconcile(tx, builder, { ...here, vocab }, undefined, false),
        )).writes,
      )
    }
    if (!writes.length) {
      return bundles
    }
    let made = resolve(writes, vocab, {}, () => crypto.randomUUID())
    yield* step(guard(made, tx, vocab))
    let gone = made.filter(dead)
    if (gone.length) yield* step(tx.remove(gone.map((b) => b.entity)))
    yield* step(tx.patch(made.filter((b) => !dead(b))))
    return [...bundles, ...made]
  })
