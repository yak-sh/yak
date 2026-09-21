// Ordered preconditions, for an application whose checks have to read state
// that storage derives. It rehearses the admitted, storage-ready change in a
// nested transaction, checking each operation against the ones written before
// it, and then ALWAYS rolls that transaction back. Unlike `$was`, these checks
// deliberately see earlier writes in the same change. No stamps and no effects
// run during the rehearsal.
import type { Bundle } from './bundle.ts'
import { dead } from './bundle.ts'
import type { Hook } from './plugin.ts'
import type { Storage } from './storage.ts'
import type { Vocab } from '@yaks/vocab'
import { each, isPromise, then } from './pipe.ts'
import { mutate } from './mutate.ts'
import { cascade } from './cascade.ts'
import { state } from './state.ts'

/** Build a precondition hook that checks each operation in a change against
 * the operations before it. Register it AFTER any storage transformations
 * (blob swaps, for instance). `check` receives one live bundle at a time, and
 * whatever it returns replaces that operation.
 *
 * The storage adapter MUST support nested, rollback-only transactions on the
 * same writer. Using a separate transaction is deliberate: rehearsing through
 * the pipeline's gathered `Tx` would leave its snapshot holding writes that
 * were rolled back. The rehearsal calls only `mutate` and `cascade`, never
 * `graph.apply`, and never runs stamps or effects. External side effects in
 * either `check` or `storage.patch` are not supported.
 */
export let preflight = (
  storage: Storage,
  vocab: Vocab,
  check: Hook,
): Hook =>
(bundles) => {
  class Rehearsed {
    constructor(public bundles: Bundle[]) {}
  }
  let finish = (err: unknown): Bundle[] => {
    if (err instanceof Rehearsed) return err.bundles
    throw err
  }
  try {
    let run = storage.tx((tx) =>
      then(
        each(bundles, [] as Bundle[], (out, b) =>
          then(tx.get([b.entity.eid]), (found) => {
            if (found.some(dead)) {
              return [...out, b]
            }
            return then(check([b], tx), (checked) => {
              let st = state()
              return then(mutate(checked, tx, st), (written) =>
                then(
                  cascade(written, tx, vocab, st),
                  () => [...out, ...checked],
                ))
            })
          })),
        (out) => {
          throw new Rehearsed(out)
        },
      )
    )
    return isPromise(run) ? run.catch(finish) : run
  } catch (err) {
    return finish(err)
  }
}
