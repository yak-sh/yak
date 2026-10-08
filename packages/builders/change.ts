// Immediate builders are a transaction rule, not an effect for every edit.
// Dependencies narrow the builders; reconciliation over the pending batch
// writes calls only for inputs that really changed or entered the selection.
import {
  type Bundle,
  type Comp,
  comps,
  dead,
  guard,
  type Hook,
  resolve,
} from '@yaks/graph'
import { after, each } from '@yaks/fp'
import { and, eq } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { step, steps } from './steps.ts'
import { reconcile } from './build.ts'

export let changing = (vocab: Vocab): Hook => (bundles, tx) => {
  if (!vocab.comp('builder_dep')) return bundles
  let changes = bundles.filter((b) =>
    !b.effect && !b.builder_dep && !b.build && !b.call && !b.result &&
    !b.execution && !b.interrupted && !b.failed && !b.refusal &&
    !(b.output as Comp | undefined)?.value
  )
  if (!changes.length) return bundles
  let sources = [
    ...new Set(changes.flatMap((b) => [
      `entity:${b.entity.eid}`,
      'component:*',
      ...comps(b).map(([name]) => `component:${name}`),
    ])),
  ]
  // One question per source: a component's dependents are the same for every
  // write, so storage answers them from memory, and an entity's are one probe
  // that finds none for nearly every entity.
  return after(
    each(
      sources,
      [] as Bundle[],
      (deps, source) =>
        after(tx.read(and(eq('builder_dep.source', source))), (found) => {
          deps.push(...found)
          return deps
        }),
    ),
    (deps) => deps.length ? apply(bundles, tx, vocab, deps) : bundles,
  )
}

let apply = (
  bundles: Bundle[],
  tx: Parameters<Hook>[1],
  vocab: Vocab,
  deps: Bundle[],
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
        ...(yield* step(reconcile(tx, builder, { vocab }, undefined, false)))
          .writes,
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
