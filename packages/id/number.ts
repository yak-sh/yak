// A human-facing number is requested explicitly, with `$num: true` on a
// bundle, never inferred from which components an entity has. The allocator
// runs inside the graph's write transaction and must be idempotent: for an
// entity that already has a number, it returns that number rather than
// assigning a new one.
//
// The plugin declares `$num` as its own request, so a graph that never
// registered it refuses the key instead of quietly dropping it, and it brings
// the `entity{num}` property with it — the request and the place the answer is
// kept arrive together.
//
// A storage adapter may answer synchronously or not, and registering this
// plugin must not turn every write into a promise — so the promise branch that
// @yaks/graph's `then` usually hides is written out below. Its types are
// restated in ./graph.ts rather than imported, for the reason given there.

import type { Bundle, Entity, Plugin } from './graph.ts'
import { idDoc } from './vocab.ts'

export let numbers = (
  mint: (eid: string) => Entity | Promise<Entity>,
): Plugin => ({
  name: 'id/numbers',
  vocab: [idDoc],
  requests: ['$num'],
  hooks: {
    cascade: (bundles, tx) => {
      let asked = [
        ...new Set(
          bundles.filter((b) => b.$num === true).map((b) => b.entity.eid),
        ),
      ]
      if (!asked.length) return bundles
      // A deleted entity reads back as `{entity, tombstone: {}}`, and a dead
      // one is not numbered.
      let fill = (found: Bundle[]): Bundle[] | Promise<Bundle[]> => {
        let live = found.filter((b) => b.tombstone == null)
        let out = [...bundles]
        let step = (i: number): Bundle[] | Promise<Bundle[]> => {
          if (i == live.length) return out
          let took = (entity: Entity) => {
            out.push({ entity })
            return step(i + 1)
          }
          let got = mint(live[i].entity.eid)
          return got instanceof Promise ? got.then(took) : took(got)
        }
        return step(0)
      }
      let found = tx.get(asked)
      return found instanceof Promise ? found.then(fill) : fill(found)
    },
  },
})
