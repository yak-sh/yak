// The table: it holds a vector per entity, and installing it again keeps them.

import { assertEquals } from '@std/assert'
import { schema, TABLE } from './ddl.ts'
import { stocked } from './testing.ts'

Deno.test('the schema is idempotent — installing twice is a no-op', async () => {
  let db = await stocked()
  for (let stmt of schema()) db.exec(stmt)
  assertEquals(
    Number(db.query(`select count(*) as n from "${TABLE}"`, [])[0].n),
    4,
  )
})
