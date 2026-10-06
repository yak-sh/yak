// Repeated human-paced chats must not inspect the schema catalog. The fixture
// counts real workerd cursor reads, including rows SQLite did not return.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { Report } from './play_cost_fixture.ts'

test('Vale embedding work reads no schema catalog while playing', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?players=2`)
  assertEquals(res.status, 200, await res.clone().text())
  let r = await res.json() as Report
  console.log('EMBEDDING_PLAY_COST', JSON.stringify(r))
  let catalog = r.profile.flatMap((p) => p.statements).filter((s) =>
    s.shape.includes('sqlite_master') || s.shape.includes('sqlite_schema')
  )
  assertEquals(catalog.reduce((n, s) => n + s.rowsRead, 0), 0)
  assertEquals(catalog.reduce((n, s) => n + s.calls, 0), 0)
  assert(r.components.embedding_owed.written > 0)
  assert(r.components.embedding.written > 0)
})
