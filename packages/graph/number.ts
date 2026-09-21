// A human-facing number is requested explicitly, with `$num: true` on a
// bundle, never inferred from which components an entity has. The allocator
// runs inside the graph's write transaction and must be idempotent: for an
// entity that already has a number, it returns that number rather than
// assigning a new one.
import type { Entity } from './bundle.ts'
import { dead } from './bundle.ts'
import type { Plugin } from './plugin.ts'
import { then } from './pipe.ts'

export let numbers = (
  mint: (eid: string) => Entity | Promise<Entity>,
): Plugin => ({
  name: 'graph/numbers',
  hooks: {
    cascade: (bundles, tx) => {
      let asked = [
        ...new Set(
          bundles.filter((b) => b.$num === true).map((b) => b.entity.eid),
        ),
      ]
      if (!asked.length) return bundles
      return then(tx.get(asked), (found) => {
        let live = found.filter((b) => !dead(b))
        let out = [...bundles]
        let step = (i: number): typeof out | Promise<typeof out> => {
          if (i == live.length) return out
          return then(mint(live[i].entity.eid), (entity) => {
            out.push({ entity })
            return step(i + 1)
          })
        }
        return step(0)
      })
    },
  },
})
