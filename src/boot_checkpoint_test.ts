import { assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import { checkpointBoot } from './boot_checkpoint.ts'
import type { Sql } from './store/sql.ts'
import { DatabaseSync } from './store/sqlite.ts'

Deno.test('boot checkpoint: committed in-memory boot is ready, open transaction is not', () => {
  let db: Sql = new DatabaseSync(':memory:')
  try {
    db.exec('create table boot (id integer)')
    checkpointBoot(db, 1)
    db.transaction(() => {
      db.exec('insert into boot values (1)')
      assertThrows(() => checkpointBoot(db, 1), Error, 'transaction open')
    })
    checkpointBoot(db, 1)
  } finally {
    db.close()
  }
})

Deno.test('boot checkpoint: busy or partial checkpoint refuses readiness', () => {
  let db: Sql = new DatabaseSync(':memory:')
  try {
    for (
      let result of [
        { busy: 1, log: 3, checkpointed: 2 },
        { busy: 0, log: 3, checkpointed: 2 },
        undefined,
      ]
    ) {
      using _prepare = stub(db, 'prepare', () => ({
        get: <T extends object>() => result as T | undefined,
        all: () => [],
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
      }))
      assertThrows(() => checkpointBoot(db, 1), Error, 'refusing ready')
    }
  } finally {
    db.close()
  }
})
