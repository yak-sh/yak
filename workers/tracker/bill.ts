// What one invocation of the object read and wrote, said when the work that
// ran it ends. The object hibernates ten seconds after its last request, so a
// cost kept for a later report would be lost with the instance; only a costly
// invocation is said, so a row bill reads as the work that ran it.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Observe } from '@yaks/durable-object'

export type Cost = { calls: number; rowsRead: number; rowsWritten: number }
export type Bill = Cost & {
  kind: string
  /** The costliest statement shapes, with no values. */
  statements: (Cost & { shape: string })[]
}

/** Each `run` is billed the rows its statements cost (`observe` hears them);
 * one costing `heavy` rows or more, read and written, is said.
 *
 * ```ts
 * import { billing } from './bill.ts'
 * import { equal } from '@yaks/testing'
 * let said: string[] = []
 * let { observe, run } = billing((b) => said.push(`${b.kind} ${b.rowsRead}`), 10)
 * await run('GET /bugs', async () => observe({ shape: 'select', rowsRead: 12, rowsWritten: 0 }))
 * await run('alarm', async () => observe({ shape: 'select', rowsRead: 3, rowsWritten: 0 }))
 * equal(said, ['GET /bugs 12'])
 * ```
 */
export let billing = (say: (bill: Bill) => void, heavy = 500) => {
  let here = new AsyncLocalStorage<Map<string, Cost>>()
  let observe: Observe = ({ shape, rowsRead, rowsWritten }) => {
    let shapes = here.getStore()
    if (!shapes) return
    let held = shapes.get(shape) ?? { calls: 0, rowsRead: 0, rowsWritten: 0 }
    shapes.set(shape, {
      calls: held.calls + 1,
      rowsRead: held.rowsRead + rowsRead,
      rowsWritten: held.rowsWritten + rowsWritten,
    })
  }
  let run = async <T>(kind: string, work: () => Promise<T>): Promise<T> => {
    let shapes = new Map<string, Cost>()
    try {
      return await here.run(shapes, work)
    } finally {
      let all = [...shapes].map(([shape, cost]) => ({ shape, ...cost }))
      let total = (k: keyof Cost) => all.reduce((n, s) => n + s[k], 0)
      let weight = (c: Cost) => c.rowsRead + c.rowsWritten
      let bill = {
        kind,
        calls: total('calls'),
        rowsRead: total('rowsRead'),
        rowsWritten: total('rowsWritten'),
      }
      if (weight(bill) >= heavy) {
        say({
          ...bill,
          statements: all.sort((a, b) => weight(b) - weight(a)).slice(0, 5)
            .map((s) => ({ ...s, shape: s.shape.slice(0, 240) })),
        })
      }
    }
  }
  return { observe, run }
}
