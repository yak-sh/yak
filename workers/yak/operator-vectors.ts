// What the Operator's object lends its store's vectors (operator-store.ts
// `Vectors`): the embedder every store's vectors are made by (embedding.ts),
// over the object's `AI` binding held to its space's budget, as an app's
// store lends its own (graph.ts `#embedder`). Its recall then ranks what the
// person said and kept by meaning (operator.ts `before`).
//
// A store learns its space from its sessions (operator-root.ts `spaceOf`).
// Until one names it, nobody pays for a vector, so no embedder is lent: its
// texts stay owed, its recall ranks by words, and nothing fails. Once the
// space is known, `ready` starts the drain that was waiting.
import type { Embedder } from '@yaks/embedding'
import type { Env } from './env.ts'
import { embedder, withheld } from './embedding.ts'
import { metered } from './metered.ts'
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
  let ask = (): void => {
    if (asking) return void (again = true)
    asking = spaceOf(o.space()).then((eid) => {
      if (!eid) return
      made = embedder({
        ...env,
        AI: env.AI && withheld(
          metered(env, async (dir) => await dir.at(eid) ?? null),
        ),
      })
      if (made) o.ready?.()
    }).catch((e) => caught(e, { request: 'operator embedding space' }))
      .finally(() => {
        asking = null
        if (!made && again) {
          again = false
          ask()
        }
      })
  }
  return {
    model: () => {
      if (!made) ask()
      return made
    },
    arm: o.arm,
    hold: o.hold,
  }
}
