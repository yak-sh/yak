// Immediate builders are a transaction rule, not an effect for every edit.
// Dependencies narrow the builders; reconciliation over the pending batch
// writes calls only for inputs that really changed or entered the selection.
// Outputs answered in place are changes too, so a chain of code steps runs to
// its end in the one write.
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

// How many steps one write's in-place answers may chain. A loop of steps
// that keep changing each other's inputs stops here, and is reported.
let STEPS = 16

export let changing = (vocab: Vocab, here: Here = {}): Hook =>
(
  bundles,
  tx,
) =>
  vocab.comp('builder_dep')
    ? chain(bundles, bundles, tx, vocab, here, 0)
    : bundles

// Reconcile the immediate builders `changed` reaches, then again for what
// they answered in place.
let chain = (
  bundles: Bundle[],
  changed: Bundle[],
  tx: Parameters<Hook>[1],
  vocab: Vocab,
  here: Here,
  depth: number,
): Bundle[] | Promise<Bundle[]> => {
  let changes = changed.filter((b) =>
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
    (deps) => {
      if (!deps.length) return bundles
      if (depth == STEPS) {
        here.report?.(
          new Error(
            `immediate builders still answering after ${STEPS} steps in one write: a loop of steps?`,
          ),
        )
        return bundles
      }
      return after(
        apply(bundles, tx, vocab, deps, here),
        (made) =>
          made.length
            ? chain([...bundles, ...made], made, tx, vocab, here, depth + 1)
            : bundles,
      )
    },
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
    if (!builders.length) return []
    let writes: Bundle[] = []
    for (let builder of builders) {
      writes.push(
        ...(yield* step(
          reconcile(tx, builder, { ...here, vocab }, undefined, false),
        )).writes,
      )
    }
    if (!writes.length) return []
    let made = resolve(writes, vocab, {}, () => crypto.randomUUID())
    yield* step(guard(made, tx, vocab))
    let gone = made.filter(dead)
    if (gone.length) yield* step(tx.remove(gone.map((b) => b.entity)))
    yield* step(tx.patch(made.filter((b) => !dead(b))))
    return made
  })
