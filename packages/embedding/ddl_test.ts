// The table: it holds a vector per entity, it is derived, and it comes back
// from nothing but the text.

import { assertEquals } from '@std/assert'
import { fields } from './fields.ts'
import { schema, TABLE } from './ddl.ts'
import { sweep } from './sweep.ts'
import { vectorOf } from './near.ts'
import { embedder, shop, stocked } from './harness.ts'

Deno.test('the schema is idempotent — installing twice is a no-op', async () => {
  let db = await stocked()
  for (let stmt of schema()) db.exec(stmt)
  assertEquals(
    Number(db.query(`select count(*) as n from "${TABLE}"`, [])[0].n),
    4,
  )
})

Deno.test('the table is derived: drop it and the sweep rebuilds it', async () => {
  let db = await stocked()
  db.exec(`drop table "${TABLE}"`)
  for (let stmt of schema()) db.exec(stmt)
  assertEquals(vectorOf(db, 'book-1', embedder.model), null)
  assertEquals(await sweep(db, fields(shop), embedder), { fresh: 4, left: 0 })
  assertEquals(vectorOf(db, 'book-1', embedder.model)?.length, 32)
})
