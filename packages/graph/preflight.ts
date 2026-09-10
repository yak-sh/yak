// Ordered preconditions for hosts whose rules read derived storage state.
// Rehearse the admitted, storage-ready batch in a nested transaction, checking
// each operation against its prefix, then ALWAYS roll it back. Unlike $was,
// these guards intentionally see earlier writes. No stamps/effects run here.
import type { Bundle } from './bundle.ts'
import { dead } from './bundle.ts'
import type { Hook } from './plugin.ts'
import type { Storage } from './storage.ts'
import type { Vocab } from '@yaks/vocab'
import { each, isPromise, then } from './pipe.ts'
import { mutate } from './mutate.ts'
import { cascade } from './cascade.ts'
import { state } from './state.ts'

/** Build a precondition hook that checks an ordered batch against its own
 * prefix. Register AFTER storage transforms (e.g. blob swaps). `check` receives
 * one live bundle at a time; its returned bundle(s) replace that operation.
 *
 * The storage MUST support nested rollback transactions on the same writer.
 * The independent transaction view is deliberate: using the pipeline's
 * gathered Tx would poison its snapshot with writes that were rolled back.
 * Rehearsal invokes only mutate/cascade, never graph.apply, stamps or effects.
 * External side effects in either `check` or storage.patch are not supported.
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
