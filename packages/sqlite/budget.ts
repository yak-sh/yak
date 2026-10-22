// What one read may materialize. A read that answers more rows or bytes than a
// process can hold is cut off where its rows are decoded and refused to its
// caller, so the process stays up for every other read. The read-only driver
// (./read-db.ts) meters each row it decodes; whoever runs reads one at a time
// starts each with `reset`.

/** The most one read may answer: rows decoded, and their size. */
export type Limits = { rows: number; bytes: number }

/** A web read's limits: a million rows or 256 MiB, well under a V8 heap's
 * 4 GB even counting the copy the answer makes on its way out. */
export let LIMITS: Limits = { rows: 1_000_000, bytes: 256 * 1024 * 1024 }

/** What a row costs beside its text and blobs: the object and its keys. */
export let ROW = 64
/** What each value costs beside its own bytes. */
export let VALUE = 16

export type Budget = {
  /** Count one decoded row of `values` values carrying `bytes` of text and
   * blobs; throws a refusal once the read passes its limits. */
  meter: (values: number, bytes: number) => void
  /** Start the next read with nothing spent. */
  reset: () => void
}

/** A budget for reads run one at a time.
 *
 * ```ts
 * import { budget } from './budget.ts'
 * import { equal, throws } from '@yaks/testing'
 *
 * let b = budget({ rows: 2, bytes: 1_000 })
 * b.meter(1, 10)
 * b.meter(1, 10)
 * let refused = await throws(() => b.meter(1, 10)) as Error
 * equal(refused.name, 'Refused')
 * equal((refused as Error & { cut?: boolean }).cut, true)
 * b.reset()
 * b.meter(1, 10)
 * await throws(() => budget({ rows: 9, bytes: 100 }).meter(2, 100), /MiB/)
 * ```
 */
export let budget = (limits: Limits = LIMITS): Budget => {
  let rows = 0, bytes = 0
  return {
    meter: (values, size) => {
      rows++
      bytes += ROW + values * VALUE + size
      if (rows <= limits.rows && bytes <= limits.bytes) return
      let error = new Error(
        `this read answers more than ${limits.rows.toLocaleString('en')} ` +
          `rows or ${limits.bytes / 1024 / 1024} MiB, more than one read ` +
          'may hold: narrow it, or add a .limit',
      )
      // A refusal to its caller, marked cut so whoever runs the read can
      // tell it from one the query itself earned.
      throw Object.assign(error, { name: 'Refused', cut: true })
    },
    reset: () => {
      rows = 0
      bytes = 0
    },
  }
}
