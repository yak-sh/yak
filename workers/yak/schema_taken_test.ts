// A store's schema pass is taken (@yaks/durable-object `take`): the request
// that first wakes it under a new print raises what the print adds, an index
// over a populated table included, and stops nothing and is never told as a
// runaway, though the store opens `free` (graph.ts `#start`).
import { equal, test } from '@yaks/testing'
import { bounded } from '@yaks/durable-object/ceiling'
import { Store } from './graph.ts'
import { KERNEL } from './meta.ts'
import { state } from './testing.ts'

test("a waking store's schema pass is told only as a scan, never a runaway", async () => {
  let name = 'ada/notes.abcdef', ctx = state(name, false), told: string[] = []
  // The test storage counts no rows; here each `create` writes one, as an
  // index build writes a row per row it indexes.
  let { exec } = ctx.storage.sql
  ctx.storage.sql.exec = (query, ...bindings) =>
    Object.assign(exec(query, ...bindings), {
      rowsRead: 0,
      rowsWritten: /^\s*create\b/i.test(query) ? 1 : 0,
    })
  let windows = [{ ms: 60_000, read: 1e9, written: 10 }]
  bounded(ctx.storage, { windows, report: (e) => told.push(e.name) })
  let r = await new Store(ctx).fetch(
    new Request('http://store/query?q=.doc', {
      headers: { ...KERNEL, 'x-store': name },
    }),
  )
  equal([r.status, told], [200, []])
})
