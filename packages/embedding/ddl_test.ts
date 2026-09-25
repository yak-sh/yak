// The table: it holds a vector per entity, and installing it again keeps them.

import { assertEquals } from '@std/assert'
import { tally } from '@yaks/sql'
import { schema, TABLE } from './ddl.ts'
import { stocked } from './testing.ts'

Deno.test('the schema is idempotent — installing twice is a no-op', async () => {
  let db = await stocked()
  for (let stmt of schema()) db.query(stmt)
  assertEquals(tally(db, TABLE), 4)
})
