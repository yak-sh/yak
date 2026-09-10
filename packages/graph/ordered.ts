// Prefix-sensitive policy: $was still reads FOUND, but these guards read what
// earlier operations wrote. Use the same mutate/cascade primitives once per
// operation, in the enclosing transaction; a late refusal rolls it all back.
import type { Bundle } from './bundle.ts'
import { dead } from './bundle.ts'
import type { Hook } from './plugin.ts'
import type { Tx } from './storage.ts'
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
  checks: Hook[],
): Bundle[] | Promise<Bundle[]> => {
  let held = holding(tx, vocab, snap)
  return each(
    bundles,
    [] as Bundle[],
    (out, b) =>
      then(held.get([b.entity.eid]), (found) => {
        if (found.some(dead)) return out
        return then(each(checks, [b], (bs, check) => check(bs, held)), (bs) => {
          let step = state()
          return then(mutate(bs, held, step), (written) =>
            then(cascade(written, tx, vocab, step), (expanded) => {
              st.born.push(...step.born)
              st.killed.push(...step.killed)
              for (let eid of step.touched) {
                st.touched.add(eid)
              }
              // Cascades write outside the gathered view. Re-read after death
              // so the next check sees releases, detached refs and casualties.
              if (step.killed.length) {
                snap.got.clear()
                snap.near.clear()
                snap.pairs.length = 0
              }
              out.push(...expanded)
              return out
            }))
        })
      }),
  )
}
