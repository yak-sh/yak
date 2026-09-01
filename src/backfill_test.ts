// Historical materialization orchestration: SQLite is read-only, while every
// generated edge lands through the caller's ordinary bounded write function.
import { assertEquals } from '@std/assert'
import { type Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, open } = await import('./db.ts')
let { historicalPrompts, landBackfill, readBackfill } = await import(
  './backfill.ts'
)
let { append } = await import('./entries.ts')
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
    { eid: task, name: 'task', comp: { priority: 1 } },
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

// The prompt backfill re-reads the transcript line a native user entry came
// from and tags the turn the harness marked typed; an injected turn and an
// already-tagged one yield nothing, so a rerun is empty.
Deno.test('historicalPrompts tags typed turns from their transcript lines', () => {
  let db = open(':memory:')
  let session = uid()
  apply(db, [{
    eid: session,
    name: 'session',
    comp: { id: `backfill-${uid()}`, transcript: '/t/one.jsonl' },
  }])
  let native = (line: number) => ({ source: 'native', line })
  let [typed] = append(
    db,
    session,
    [{
      message: { role: 'user' },
      content: { body: 'fix it' },
    }],
    null,
    undefined,
    native(2),
  ).eids
  append(
    db,
    session,
    [{
      message: { role: 'user' },
      content: { body: 'Stop hook feedback: x' },
    }],
    null,
    undefined,
    native(3),
  )
  let lines = [
    '{"type":"system"}',
    '{"type":"user","origin":{"kind":"human"},"promptSource":"typed"}',
    '{"type":"user","isMeta":true}',
  ]
  let read = (path: string) => {
    assertEquals(path, '/t/one.jsonl')
    return lines.join('\n')
  }
  let pending = historicalPrompts(db, read)
  assertEquals(pending, [{ eid: typed, name: 'prompt', comp: {} }])
  apply(db, pending)
  assertEquals(historicalPrompts(db, read), [])
  db.close()
})
