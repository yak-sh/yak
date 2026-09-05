// The store, bound. One line of composition: a Durable Object's storage
// becomes a driver (./sql.ts), and @yaks/sqlite turns that driver plus a
// vocabulary into the whole `Storage` seam — schema, reads, patches, cascade,
// transactions. This package writes no SQL of its own, which is the point: a
// graph reads the same in an object as it does on a server.

import type { Opts, Store } from '@yaks/sqlite'
import { storage as bind } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import { driver, type DurableStorage } from './sql.ts'

export type { Opts, Store }

/**
 * Bind a store to a Durable Object's storage and a vocabulary — the
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} `Storage` a graph applies
 * changes to, answered synchronously because the object's SQLite is.
 *
 * `install()` it once (create-if-not-exists, so a constructor may call it every
 * time the object wakes). `base` options — a derived-column registry, a fixed
 * `now` for time phrases — ride every read; its `text` (how a column whose
 * stored value is not its own words reads as text) rides the schema.
 *
 * ```ts
 * // let store = storage(ctx.storage, vocab)
 * // store.install()
 * // let g = graph({ storage: store, vocab })
 * ```
 */
export let storage = (
  durable: DurableStorage,
  vocab: Vocab,
  base: Opts = {},
): Store => bind(driver(durable), vocab, base)
