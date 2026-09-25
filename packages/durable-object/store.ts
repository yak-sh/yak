// The store, bound. One line of composition: a Durable Object's storage
// becomes a driver (./sql.ts), and @yaks/sqlite turns that driver plus a
// vocabulary into a whole `Storage` implementation — schema, reads, patches,
// cascading deletes, transactions. This package writes no SQL of its own, which
// is the point: a graph reads the same inside an object as it does on a
// server.

import type { Opts, Store } from '@yaks/sqlite'
import { storage as bind } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import { driver, type DurableStorage } from './sql.ts'

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
export let storage = (
  durable: DurableStorage,
  vocab: Vocab,
  base: Opts = {},
): Store => bind(driver(durable), vocab, base)
