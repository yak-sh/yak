// Repeated human-paced chats must not inspect the schema catalog. The fixture
// counts real workerd cursor reads, including rows SQLite did not return.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { playReport } from './play_report_fixture.ts'

test('Vale embedding work reads no schema catalog while playing', async () => {
  let r = await playReport()
  console.log('EMBEDDING_PLAY_COST', JSON.stringify(r))
  let catalog = r.profile.flatMap((p) => p.statements).filter((s) =>
    s.shape.includes('sqlite_master') || s.shape.includes('sqlite_schema')
  )
  assertEquals(catalog.reduce((n, s) => n + s.rowsRead, 0), 0)
  assertEquals(catalog.reduce((n, s) => n + s.calls, 0), 0)
  assert(r.components.embedding_owed.written > 0)
  assert(r.components.embedding.written > 0)
})

test('chat commits check owed text once before their embedding pass', async () => {
  let r = await playReport()
  let queued = r.sourceShapes.chatting.filter((s) =>
    s.sql.includes('from "embedding_owed"')
  )
  assertEquals(queued.reduce((n, s) => n + s.cost.read, 0), 4)
  assert(r.components.embedding.written > 0)
})
