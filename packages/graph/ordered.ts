// Writing one operation at a time, for a plugin whose checks depend on what
// earlier operations in the same change wrote. `$was` still compares against
// the state before the change; these `beforeWrite` hooks see everything
// written before them. It reuses the same mutate and cascade functions, once
// per operation, inside the enclosing transaction — so a refusal at the end
// rolls back everything that came before it.
import { after, each } from '@yaks/fp'
import { type Bundle, dead } from './bundle.ts'
import type { WriteHook } from './plugin.ts'
import type { Tx } from './storage.ts'
import type { Vocab } from '@yaks/vocab'
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
  let killed = new Set(st.killed)
  return each(
    checks.every((check) => check.independent)
      ? [bundles]
      : bundles.map((b) => [b]),
    [] as Bundle[],
    (out, batch) => {
      // Only this change's own deaths win over its later patches. A grave
      // from an earlier change belongs to mutate: a fresh write revives it,
      // while a write carrying old $was values is swallowed as a race.
      let live = batch.filter((b) => !killed.has(b.entity.eid))
      if (!live.length) return out
      return after(
        each(checks, live, (bs, check) => check(bs, held)),
        (bs) => {
          let step = state()
          return after(
            mutate(bs, held, step, vocab),
            (written) =>
              after(cascade(written, tx, vocab, step), (expanded) => {
                for (let b of expanded) {
                  if (dead(b)) killed.add(b.entity.eid)
                }
                st.born.push(...step.born)
                st.killed.push(...step.killed)
                st.heard.push(...step.heard)
                for (let eid of step.touched) {
                  st.touched.add(eid)
                }
                if (step.killed.length) {
                  snap.got.clear()
                  snap.only?.clear()
                  snap.near.clear()
                  snap.pairs.length = 0
                }
                out.push(...expanded)
                return out
              }),
          )
        },
      )
    },
  )
}
