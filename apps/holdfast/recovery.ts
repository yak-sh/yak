/** Settle one already-decided batch without ever deciding or charging it again. */
import { WriteRefused, WriteUnknown } from '@yaks/client'
import type { Row } from './model.ts'

export type RecoveryPorts = {
  /** Send this exact batch, including its original ledger id and guards. */
  write: (batch: Row[]) => Promise<unknown>
  /** Authoritative server rows for ALL batch ids, never the optimistic replica. */
  read: (batch: Row[]) => Promise<Row[]>
  /** Restore returned server rows/deletions and apply held nonserver companions.
   * Called once only when a receipt proves an unknown write landed; a normal
   * write's own acknowledgement already does that work.
   */
  accept: (rows: Row[]) => void | Promise<unknown>
  report: (error: unknown) => void
  wait: () => Promise<unknown>
}

const receipts = ['spent', 'cleared', 'run'] as const

// Compare the patch's properties, not response ordering or server-added stamps.
const matches = (expected: unknown, actual: unknown): boolean => {
  if (expected === actual) return true
  if (
    !expected || !actual || typeof expected !== 'object' ||
    typeof actual !== 'object'
  ) return false
  return Object.entries(expected).every(([key, value]) =>
    Object.hasOwn(actual, key) &&
    matches(value, (actual as Record<string, unknown>)[key])
  )
}

/**
 * The caller retains this immutable batch while recovery is pending. Its
 * spent/cleared/run patches are existing, immutable receipts of an atomic
 * server commit; mutable tower or conductor values cannot prove acceptance.
 *
 * Reads must bypass the local optimistic graph and return whole current rows
 * for every affected id. `accept` owns replica repair (including absent ids)
 * and the original batch's nonserver companions, not another server write.
 * Receipt-free peer/local writes can succeed normally, but an unknown durable
 * write without a receipt is an error rather than an unsafe blind replay.
 */
export async function recover(
  batch: Row[],
  ports: RecoveryPorts,
): Promise<void> {
  let witnesses = batch.flatMap((row) =>
    row.$delete ? [] : receipts.flatMap((component) =>
      row[component]
        ? [{
          eid: row.entity.eid,
          component,
          // A sale clears spent.tower through its reference death policy.
          // The immutable ledger amount/run still proves that transaction.
          value: component === 'spent' && batch.some((r) =>
              r.$delete && r.entity.eid === row.spent!.tower
            )
            ? { run: row.spent!.run, gold: row.spent!.gold }
            : row[component],
        }]
        : []
    )
  )
  let unknown = false
  // A failed read says nothing about acceptance. Delay and read again; do not
  // resend until a successful authoritative read has checked the receipts.
  let reconcile = async () => {
    if (!witnesses.length) {
      throw new Error(
        'Cannot recover an unknown write without an immutable receipt.',
      )
    }
    for (;;) {
      await ports.wait()
      let rows: Row[]
      try {
        rows = await ports.read(batch)
      } catch (error) {
        ports.report(error)
        continue
      }
      return {
        rows,
        landed: witnesses.every(({ eid, component, value }) =>
          rows.some((row) =>
            !row.$delete && row.entity.eid === eid &&
            matches(value, row[component])
          )
        ),
      }
    }
  }
  try {
    for (;;) {
      let refusal: WriteRefused | undefined
      try {
        await ports.write(batch)
        return
      } catch (error) {
        if (error instanceof WriteUnknown) {
          ports.report(error)
          unknown = true
        } else if (error instanceof WriteRefused && unknown) {
          // The first POST may have committed after our last read, making the
          // retry's original guard refuse. Check its receipt before failing.
          refusal = error
        } else {
          throw error
        }
      }
      let { rows, landed } = await reconcile()
      if (landed) {
        if (refusal) ports.report(refusal)
        await ports.accept(rows)
        return
      }
      if (refusal) throw refusal
      // Never regenerate a purchase, allocate a new ledger or drop its guard.
    }
  } catch (error) {
    ports.report(error)
    throw error
  }
}
