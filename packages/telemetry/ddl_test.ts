// The table: idempotent to install, and a source nobody declared is refused
// at the table, where the failure is loud.

import { assertEquals, assertThrows } from '@std/assert'
import { schema, SOURCES, TABLE } from './ddl.ts'
import { mem } from './harness.ts'

Deno.test('the schema is idempotent', () => {
  let db = mem()
  for (let stmt of schema()) db.exec(stmt)
  assertEquals(db.query(`select count(*) as n from "${TABLE}"`, [])[0].n, 0)
})

Deno.test('every declared source is accepted; an undeclared one is refused', () => {
  let db = mem()
  for (let s of SOURCES) {
    db.query(`insert into "${TABLE}" (source, name, ok) values (?, 'x', 1)`, [
      s,
    ])
  }
  assertEquals(db.query(`select count(*) as n from "${TABLE}"`, [])[0].n, 5)
  assertThrows(() =>
    db.query(
      `insert into "${TABLE}" (source, name, ok) values ('ftp', 'x', 1)`,
      [],
    )
  )
})
