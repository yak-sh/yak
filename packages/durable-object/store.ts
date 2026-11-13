// The store, bound. One line of composition: a Durable Object's storage
// becomes a driver (./sql.ts), and @yaks/sqlite turns that driver plus a
// vocabulary into a whole `Storage` implementation — schema, reads, patches,
// cascading deletes, transactions. This package writes no SQL of its own, which
// is the point: a graph reads the same inside an object as it does on a
// server.

import type { Opts, Store } from '@yaks/sqlite'
import { storage as bind } from '@yaks/sqlite'
import { bounded } from './ceiling.ts'
import type { Vocab } from '@yaks/vocab'
import {
  driver,
  type DurableStorage,
  type Measure,
  type Observe,
} from './sql.ts'

export type { Opts, Store }

/**
 * Bind a store to a Durable Object's storage and a vocabulary — the
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} `Storage` a graph applies
 * changes to, implemented synchronously because the object's SQLite is.
 *
 * `install()` it once (create-if-not-exists, so a constructor may call it every
 * time the object wakes). `base` options — a derived-property registry, a fixed
 * `now` for time phrases — are applied to every read, and the registry's
 * `text` expressions (how a property whose stored value is not its text reads
 * as text) to the schema.
 *
 * ```ts
 * // let store = storage(ctx.storage, vocab)
 * // store.install()
 * // let g = graph({ storage: store, vocab })
 * ```
 */
// The share of each window a maintenance unit may spend: most of it for a
// large unit, which could otherwise never fit beside the object's own work.
let share = (written: number) => written > 10_000 ? 0.9 : 0.5

export let storage = (
  durable: DurableStorage,
  vocab: Vocab,
  base: Opts = {},
  observe?: Observe,
  measure?: Measure,
): Store & { upkeep: (run?: boolean) => number | null } => {
  let store = bind(driver(durable, observe, measure), vocab, base)
  let bound = bounded(durable)
  return Object.assign(store, {
    // Previewing a unit arms a host without running maintenance at boot.
    // A unit no window can hold (an index over a spine past its writes in a
    // minute) runs free, told and never refused, as a deploy's install does:
    // paced, it would wait for a window that never comes, and the object
    // would serve without it for good.
    upkeep: (run = true) => {
      let wait = Infinity, huge = false
      let worked = store.maintain((written) => {
        let next = bound.under(share(written), written)
        if (next == Infinity) {
          huge = true
          wait = 0
          return false
        }
        wait = Math.min(wait, next)
        return run && next == 0
      })
      if (!worked && huge && run) {
        worked = bound.free(() =>
          store.maintain((written) =>
            bound.under(share(written), written) == Infinity
          )
        )
      }
      return worked ? 0 : Number.isFinite(wait) ? wait : null
    },
  })
}
