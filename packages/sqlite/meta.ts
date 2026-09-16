// The store's own key/value: the few facts a store keeps ABOUT itself rather
// than about the entities in it — the sync epoch a returning client checks its
// cursor against, a sweep's high-water mark, the marker that says a one-shot
// repair has already run.
//
// It sits BESIDE the graph on purpose. A row here has no entity id and no
// component, so nothing that walks the vocabulary can carry it: not a read, not
// a bundle, not a client cache. A host that needs a durable scalar and does not
// want it on the wire writes it here instead of inventing a component for it.
//
// The table is `server_meta` (ddl.ts {@link META}), raised by `schema()` with
// the rest of the spine, so a store that installed already has it.

import { type Driver, effect } from './driver.ts'
import { META } from './ddl.ts'

/** Read, write, clear — the whole seam. Values are text; a host that wants a
 * number or an instant spells it itself, the way it will read it back. */
export type Meta = {
  get: (k: string) => string | undefined
  set: (k: string, v: string) => void
  del: (k: string) => void
}

/** Bind the key/value seam to a driver. */
export let meta = (driver: Driver): Meta => ({
  get: (k) => {
    let row = driver.query(`select v from "${META}" where k = ?`, [k])[0]
    return row ? String(row.v) : undefined
  },
  set: (k, v) =>
    effect(
      driver,
      `insert into "${META}" (k, v) values (?, ?)
       on conflict(k) do update set v = excluded.v`,
      [k, v],
    ),
  del: (k) => effect(driver, `delete from "${META}" where k = ?`, [k]),
})

/** The key the epoch is kept under. */
export let EPOCH = 'epoch'

/**
 * The store's lineage identity: a string minted ONCE and persisted, so it
 * survives a restart, a deploy and a handover — a returning client whose cursor
 * carries this epoch may resume where it left off, and a client holding another
 * store's epoch (or none) must start over, because rows from a different
 * lineage can never be replayed against it.
 *
 * `install()` mints it, and this is idempotent (`insert or ignore`): a store
 * that already has one keeps it and reads it back. It WRITES, so a read-only
 * path asks `meta(driver).get(EPOCH)` instead and treats an absent one as a
 * store no cursor can be trusted against.
 */
export let epoch = (driver: Driver): string => {
  effect(
    driver,
    `insert or ignore into "${META}" (k, v) values (?, ?)`,
    [EPOCH, crypto.randomUUID()],
  )
  return meta(driver).get(EPOCH)!
}
