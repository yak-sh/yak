// The store's own key/value: the few facts a store keeps about itself rather
// than about the entities in it — the sync epoch a returning client checks its
// cursor against, a sweep's high-water mark, the marker recording that a
// one-shot repair has already run, the plugins its data requires.
//
// It sits beside the graph on purpose. A row here has no entity id and no
// component, so nothing that walks the vocabulary can carry it: not a read, not
// a bundle, not a client cache. An application that needs a durable scalar and
// does not want clients to read it writes it here instead of inventing a
// component for it.
//
// The table is `server_meta` (ddl.ts {@link META}), created by `schema()` with
// the rest of the spine, so a store that has installed already has it.

import {
  and,
  col,
  type Driver,
  effect,
  eq,
  ge,
  lt,
  select,
  table,
  val,
} from '@yaks/sql/core'
import { META } from './layout.ts'

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

/** What a full-analysis engine's planner statistics stand at (./ddl.ts
 * `analyzed`): the stored bytes growth is measured from, the tables that held
 * no rows when last looked at (no SQLite statistics row remembers them), and
 * the tables owed an analysis, in the order they are worked off. */
export type Statistics = { bytes: number; empty: string[]; owed?: string[] }

/** The fingerprint of the schema this file last had installed, or undefined
 * for a file no install has finished in — one that may not have this table
 * yet. */
export let installed = (driver: Driver): string | undefined =>
  installation(driver)?.schema

/** The schema and its analysis receipt share the installation's existing
 * metadata read. File stores keep their plain stamp; full analysis records
 * stored bytes after a successful pass so another incarnation can skip it. */
export let installation = (
  driver: Driver,
): { schema: string; statistics?: Statistics } | undefined => {
  let value = kept(driver, SCHEMA)
  if (value == null) return
  let [schema, statistics] = value.split('\n')
  return {
    schema,
    statistics: statistics == null ? undefined : JSON.parse(statistics),
  }
}

/** Keep an analysis receipt without changing the public schema fingerprint. */
export let analyzedAt = (
  driver: Driver,
  schema: string,
  statistics: Statistics,
): void => meta(driver).set(SCHEMA, `${schema}\n${JSON.stringify(statistics)}`)

/** The prefix of the key a file records each composed schema's print under
 * (./follow.ts): `schema:<print>`, its value when it was recorded. */
export let PRINTED = 'schema:'

/** Whether this file has recorded the composed schema `print` names. */
export let printed = (driver: Driver, print: string): boolean =>
  kept(driver, PRINTED + print) != null

/** The prefix of the key a file records each survey of a store's schema under
 * (./survey.ts): `surveyed:<print>`, the store's print. */
export let SURVEYED = 'surveyed:'

/** The survey this file recorded of the store schema `print` names, as it
 * was recorded. */
export let surveyedAt = (driver: Driver, print: string): string | undefined =>
  kept(driver, SURVEYED + print)

/** The prefix of the key a store records each plugin its data requires under:
 * `required:<plugin>`, its value when it was recorded. A host that does not
 * compose every one refuses to open the store (@yaks/host `meet`). A plugin
 * removed on purpose drops its row:
 * `delete from server_meta where k = 'required:@yaks/journal'`. */
export let REQUIRED = 'required:'

// The first key past every `required:` key.
let AFTER = REQUIRED.slice(0, -1) + ';'

/** The plugins this store's data requires: one range read of `server_meta`,
 * and none where the table is not there yet. */
export let requirements = (driver: Driver): string[] =>
  driver.query({ t: 'pragma', name: 'table_info', arg: META }).length
    ? driver.query(select({
      cols: [col('k')],
      from: table(META),
      where: and(ge(col('k'), val(REQUIRED)), lt(col('k'), val(AFTER))),
    })).map((r) => String(r.k).slice(REQUIRED.length))
    : []

/** Record that this store's data requires each of `plugins`, from now on. A
 * plugin it already requires keeps the time it was first recorded. */
export let requires = (driver: Driver, plugins: readonly string[]): void => {
  if (!plugins.length) return
  let at = new Date().toISOString()
  effect(driver, {
    t: 'insert',
    or: 'ignore',
    into: META,
    cols: ['k', 'v'],
    rows: plugins.map((p) => [val(REQUIRED + p), val(at)]),
  })
}

// A key's value, read without assuming the table is there yet. The table is
// asked after by name (`table_info`, empty for one that is not there) rather
// than found in the whole catalogue, which a store reads on every wake.
let kept = (driver: Driver, k: string): string | undefined =>
  driver.query({ t: 'pragma', name: 'table_info', arg: META }).length
    ? meta(driver).get(k)
    : undefined

/** The store's epoch where one was minted, read without minting it: what a
 * read asks, where {@link epoch} writes. */
export let epochAt = (driver: Driver): string | undefined => kept(driver, EPOCH)

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
