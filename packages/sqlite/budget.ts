// What one read may materialize. A read that answers more rows or bytes than a
// process can hold is cut off where its rows are decoded and refused to its
// caller, so the process stays up for every other read. A store's reads
// (./mod.ts) each run `metered`, and both engines (./native.ts, ./read-db.ts)
// `meter` each row they decode against the read running. Reads over SQLite are
// synchronous, so one thread runs one at a time, and the running one is the one
// a row belongs to.

import { Refused } from '@yaks/graph/errors'
import type { Row } from '@yaks/sql'
import { mask, stringify } from '@yaks/query'
import type { Query } from './read.ts'

/** The most one read may answer: rows decoded, and their size. */
export type Limits = { rows: number; bytes: number }

/** A read's limits: a million rows or 256 MiB. Measured on the box's graph:
 * its pages and tools spend at most 35,000 rows and 5 MiB a read,
 * a million narrow rows meter about 120 MiB, and a read cut at 256 MiB peaks
 * near 480 MiB of a V8 heap's 4 GB while it decodes. */
export let LIMITS: Limits = { rows: 1_000_000, bytes: 256 * 1024 * 1024 }

/** What a row costs beside its text and blobs: the object and its keys. */
export let ROW = 64
/** What each value costs beside its own bytes. */
export let VALUE = 16

// The read running on this thread, and what it has spent.
let running:
  | { rows: number; bytes: number; limits: Limits; what?: () => string }
  | undefined

/** Run `read`, refusing it once the rows it decodes pass `limits`, the
 * refusal naming the read as `what` says, so its caller and any report of it
 * can tell which read it was. A read inside another counts against the outer
 * one.
 *
 * ```ts
 * import { meter, metered } from './budget.ts'
 * import { equal, throws } from '@yaks/testing'
 *
 * let scan = (n: number) => () => {
 *   for (let i = 0; i < n; i++) meter({ x: 'x' })
 *   return n
 * }
 * let limits = { rows: 2, bytes: 1_000 }
 * equal(metered(scan(2), { limits }), 2)
 * let refused = await throws(() => metered(scan(3), { limits }))
 * equal((refused as Error).name, 'Refused')
 * let what = () => '.task'
 * await throws(() => metered(scan(3), { what, limits }), /^\.task answers/)
 * let narrow = { rows: 9, bytes: 100 }
 * await throws(() => metered(scan(2), { limits: narrow }), /MiB/)
 * meter({ x: 'outside any read, nothing is counted' })
 * ```
 */
export let metered = <R>(
  read: () => R,
  { what, limits = LIMITS }: { what?: () => string; limits?: Limits } = {},
): R => {
  if (running) return read()
  running = { rows: 0, bytes: 0, limits, what }
  try {
    return read()
  } finally {
    running = undefined
  }
}

/** A query read, named as a trace keeps it: every value masked, bounded. */
export let named = (query: Query) => (): string =>
  mask(typeof query == 'string' ? query : stringify(query)).slice(0, 512)

/** A get, named by how many entities it asked for. */
export let gotten = (eids: unknown[]) => (): string =>
  `get of ${eids.length} entities`

/** Count one decoded row against the read running, if one is; throws a
 * refusal once the read passes its limits. */
export let meter = (row: Row): void => {
  if (!running) return
  let bytes = ROW
  for (let key in row) {
    let value = row[key]
    bytes += VALUE +
      (typeof value == 'string'
        ? value.length
        : value instanceof Uint8Array
        ? value.byteLength
        : 0)
  }
  let { limits, what } = running
  running.rows++
  running.bytes += bytes
  if (running.rows <= limits.rows && running.bytes <= limits.bytes) return
  throw new Refused(
    `${what?.() ?? 'this read'} answers more than ` +
      `${limits.rows.toLocaleString('en')} rows or ` +
      `${limits.bytes / 1024 / 1024} MiB, more than one read may hold: ` +
      'narrow it, or add a .limit',
  )
}
