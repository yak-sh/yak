// What the Operator's object lends its store's vectors (operator-store.ts
// `Vectors`): the embedder every store's vectors are made by (embedding.ts),
// over the object's `AI` binding held to its space's budget, as an app's
// store lends its own (graph.ts `#embedder`). Its recall then ranks what the
// person said and kept by meaning (operator.ts `before`).
import type { Embedder } from '@yaks/embedding'
import type { Env } from './env.ts'
import { embedder, withheld } from './embedding.ts'
import { metered } from './metered.ts'
import { spaceOf } from './operator-root.ts'
import type { OperatorStore, Vectors } from './operator-store.ts'

export let operatorVectors = (
  env: Env,
  o: {
    space: () => Pick<OperatorStore, 'g'>
    arm: Vectors['arm']
    hold: Vectors['hold']
  },
): Vectors => {
  let made: Embedder | null | undefined
  return {
    model: () =>
      made ??= embedder({
        ...env,
        AI: env.AI && withheld(metered(env, async (dir) => {
          let eid = await spaceOf(o.space())
          return eid ? await dir.at(eid) ?? null : null
        })),
      }),
    arm: o.arm,
    hold: o.hold,
  }
}
