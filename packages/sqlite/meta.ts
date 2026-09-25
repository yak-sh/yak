// The store's own key/value: the few facts a store keeps about itself rather
// than about the entities in it — the sync epoch a returning client checks its
// cursor against, a sweep's high-water mark, the marker recording that a
// one-shot repair has already run.
//
// It sits beside the graph on purpose. A row here has no entity id and no
// component, so nothing that walks the vocabulary can carry it: not a read, not
// a bundle, not a client cache. An application that needs a durable scalar and
// does not want clients to read it writes it here instead of inventing a
// component for it.
//
// The table is `server_meta` (ddl.ts {@link META}), created by `schema()` with
// the rest of the spine, so a store that has installed already has it.

import { col, type Driver, effect, eq, select, table, val } from '@yaks/sql'
import { META } from './ddl.ts'

/** Read, write, clear — the whole interface. Values are text; an application
 * that wants a number or a timestamp formats it itself, the way it will parse
 * it back. */
export type Meta = {
  get: (k: string) => string | undefined
  set: (k: string, v: string) => void
  del: (k: string) => void
}

/** Bind the key/value interface to a driver. */
export let meta = (driver: Driver): Meta => ({
  get: (k) => {
    let row = driver.query(select({
      cols: [col('v')],
      from: table(META),
      where: eq(col('k'), val(k)),
    }))[0]
    return row ? String(row.v) : undefined
  },
  set: (k, v) =>
    effect(driver, {
      t: 'insert',
      into: META,
      cols: ['k', 'v'],
      rows: [[val(k), val(v)]],
      upsert: [{ on: [col('k')], set: { v: col('v', 'excluded') } }],
    }),
  del: (k) =>
    effect(driver, { t: 'delete', from: META, where: eq(col('k'), val(k)) }),
})

/** The key the epoch is kept under. */
export let EPOCH = 'epoch'

/** The key the fingerprint of the installed schema is kept under (mod.ts
 * `install`). */
export let SCHEMA = 'schema'

/** The fingerprint of the schema this file last had installed, or undefined
 * for a file no install has finished in — one that may not have this table
 * yet. */
export let installed = (driver: Driver): string | undefined =>
  driver.query(select({
      cols: [col('name')],
      from: table('sqlite_schema'),
      where: eq(col('name'), val(META)),
    })).length
    ? meta(driver).get(SCHEMA)
    : undefined

/**
 * The store's lineage identity: a string minted once and persisted, so it
 * survives a restart, a deploy and a handover — a returning client whose cursor
 * carries this epoch may resume where it left off, and a client holding another
 * store's epoch (or none) must start over, because rows from a different
 * lineage can never be replayed against it.
 *
 * `install()` mints it, and this is idempotent (`insert or ignore`): a store
 * that already has one keeps it and reads it back. It writes, so a read-only
 * path calls `meta(driver).get(EPOCH)` instead and treats an absent one as a
 * store no cursor can be trusted against.
 */
export let epoch = (driver: Driver): string => {
  effect(driver, {
    t: 'insert',
    or: 'ignore',
    into: META,
    cols: ['k', 'v'],
    rows: [[val(EPOCH), val(crypto.randomUUID())]],
  })
  return meta(driver).get(EPOCH)!
}
