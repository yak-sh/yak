// What the Operator's object lends its store's vectors (operator-store.ts
// `Vectors`): the embedder every store's vectors are made by (embedding.ts),
// over the object's `AI` binding held to its space's budget, as an app's
// store lends its own (graph.ts `#embedder`). Its recall then ranks what the
// person said and kept by meaning (operator.ts `before`).
//
// A store uses the space it keeps, or learns it from its sessions
// (operator-root.ts `spaceOf`). Its texts stay owed until that space is known.
import type { Embedder } from '@yaks/embedding'
import type { Env } from './env.ts'
import { embedder, withheld } from './embedding.ts'
import { embeddings } from './metered.ts'
import { spaceOf } from './operator-root.ts'
import type { OperatorStore, Vectors } from './operator-store.ts'
import { caught } from './defects.ts'

export let operatorVectors = (
  env: Env,
  o: {
    space: () => Pick<OperatorStore, 'g' | 'marks'>
    arm: Vectors['arm']
    hold?: Vectors['hold']
    /** called once the space is known and an embedder can be lent */
    ready?: () => void
  },
): Vectors => {
  let made: Embedder | null = null
  // The lookup in flight, and whether a write asked during it: one made
  // before its first session was written answers no space, and is asked again.
  let asking: Promise<void> | null = null
  let again = false
  let lend = (eid: string) =>
    embedder({
      ...env,
      AI: withheld(embeddings(env, async (dir) => await dir.at(eid) ?? null)),
    })
  let model = (): Embedder | null => {
    if (made || !env.AI) return made
    let at = spaceOf(o.space())
    if (typeof at == 'string') return made = lend(at)
    if (asking) {
      again = true
      return null
    }
    asking = at.then((eid) => {
      if (!eid || made) return
      made = lend(eid)
      if (made) o.ready?.()
    }).catch((e) => caught(e, { request: 'operator embedding space' }))
      .finally(() => {
        asking = null
        if (!made && again) {
          again = false
          model()
        }
      })
    return null
  }
  return {
    model,
    arm: o.arm,
    hold: o.hold,
  }
}
