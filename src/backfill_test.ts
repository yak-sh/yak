// Historical materialization orchestration: SQLite is read-only, while every
// generated edge lands through the caller's ordinary bounded write function.
import { assertEquals } from '@std/assert'
import { type Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, open } = await import('./db.ts')
let { landBackfill, readBackfill } = await import('./backfill.ts')
let { graph } = await import('./reload.ts')

let uid = () => crypto.randomUUID()
let idOf = `(select id from entity where eid = ?)`

Deno.test('the backfill library has no live database dependency', () => {
  assertEquals(graph('backfill.ts').has('live_db.ts'), false)
})

Deno.test('readBackfill scans SQLite while landBackfill owns no write path', async () => {
  let path = await Deno.makeTempFile({ suffix: '.db' })
  let db = open(path)
  let session = uid(), task = uid()
  apply(db, [
    { eid: session, name: 'session', comp: { id: `backfill-${uid()}` } },
    { eid: task, name: 'doc', comp: { title: 'historical task' } },
    { eid: task, name: 'task', comp: { status: 'open', priority: 1 } },
  ])
  apply(db, [{ eid: task, name: 'claim', comp: { session } }])
  apply(db, [{ eid: task, name: 'claim', comp: null }])
  db.prepare(`
    delete from dependency
    where parent = ${idOf} and type = 'worked' and child = ${idOf}
  `).run(session, task)
  db.close()

  let pending = readBackfill(path, 'worked')
  assertEquals(pending, [{
    eid: session,
    name: 'dependency',
    comp: { type: 'worked', child: task },
  }])

  // The read did not land its own result. Only the injected generic writer
  // makes progress, matching CLI send() and MCP io.write().
  assertEquals(readBackfill(path, 'worked'), pending)
  let writer = open(path)
  let out = await landBackfill(
    pending,
    (batch) => Promise.resolve(apply(writer, batch)),
  )
  assertEquals(out, { found: 1, submitted: 1, landed: 1 })
  writer.close()
  assertEquals(readBackfill(path, 'worked'), [])
  await Deno.remove(path)
})

Deno.test('landBackfill reports each bounded batch', async () => {
  let pending: Change[] = Array.from({ length: 450 }, (_, i) => ({
    eid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: 'dependency',
    comp: { type: 'worked', child: crypto.randomUUID() },
  }))
  let batches: number[] = []
  let progress: { found: number; submitted: number; landed: number }[] = []
  let out = await landBackfill(
    pending,
    (batch) => {
      batches.push(batch.length)
      return Promise.resolve(batch)
    },
    (state) => progress.push({ ...state }),
  )
  assertEquals(batches, [200, 200, 50])
  assertEquals(progress.map((p) => p.submitted), [0, 200, 400, 450])
  assertEquals(out, { found: 450, submitted: 450, landed: 450 })
})
