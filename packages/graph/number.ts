// Human handles are requested by a door, never inferred from components.
// The allocator runs under the graph's write transaction and must be
// idempotent: an existing number is returned, never replaced.
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
