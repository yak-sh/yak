// Writing one operation at a time, for a plugin whose checks depend on what
// earlier operations in the same change wrote. `$was` still compares against
// the state before the change; these `beforeWrite` hooks see everything
// written before them. It reuses the same mutate and cascade functions, once
// per operation, inside the enclosing transaction — so a refusal at the end
// rolls back everything that came before it.
import type { Bundle } from './bundle.ts'
import { dead } from './bundle.ts'
import type { WriteHook } from './plugin.ts'
import { pick, type Tx } from './storage.ts'
import type { Vocab } from '@yaks/vocab'
import { each, then } from './pipe.ts'
import { mutate } from './mutate.ts'
import { cascade } from './cascade.ts'
import { holding, type Snap } from './gather.ts'
import { type State, state } from './state.ts'

export let ordered = (
  bundles: Bundle[],
  tx: Tx,
  vocab: Vocab,
  snap: Snap,
  st: State,
  checks: WriteHook[],
): Bundle[] | Promise<Bundle[]> => {
  let held = holding(tx, vocab, snap)
  return each(
    checks.every((check) => check.independent)
      ? [bundles]
      : bundles.map((b) => [b]),
    [] as Bundle[],
    (out, batch) =>
      then(
        pick(held, batch.map((b) => b.entity.eid), ['tombstone']),
        (found) => {
          let gone = new Set(found.filter(dead).map((b) => b.entity.eid))
          let live = batch.filter((b) => !gone.has(b.entity.eid))
          if (!live.length) return out
          return then(
            each(checks, live, (bs, check) => check(bs, held)),
            (bs) => {
              let step = state()
              return then(mutate(bs, held, step), (written) =>
                then(cascade(written, tx, vocab, step), (expanded) => {
                  st.born.push(...step.born)
                  st.killed.push(...step.killed)
                  for (let eid of step.touched) {
                    st.touched.add(eid)
                  }
                  // A cascade writes rows the gather never read. Clear the
                  // snapshot after a delete, so the next check sees the
                  // released rows, the cleared references, and the entities
                  // the cascade deleted.
                  if (step.killed.length) {
                    snap.got.clear()
                    snap.only?.clear()
                    snap.near.clear()
                    snap.pairs.length = 0
                  }
                  out.push(...expanded)
                  return out
                }))
            },
          )
        },
      ),
  )
}
