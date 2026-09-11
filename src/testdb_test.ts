import { assertEquals, assertNotEquals, assertThrows } from '@std/assert'
import { bareDb, dbFixture, freshDb } from './testdb.ts'

Deno.test('scenario snapshots build once and isolate every writable clone', () => {
  let builds = 0
  let fixture = dbFixture((db) => {
    builds++
    db.exec(
      "create table scenario (value text); insert into scenario values ('initial')",
    )
    return { label: 'scenario' }
  })
  let first = fixture()
  assertEquals(first.label, 'scenario')
  first.db.exec("update scenario set value = 'changed'")
  let second = fixture()
  assertNotEquals(first.db, second.db)
  assertEquals(first.db.isOpen, false)
  assertEquals(builds, 1)
  assertEquals(second.db.prepare('select * from scenario').all(), [{
    value: 'initial',
  }])
  // All fixture doors share the single-live-clone contract, even when a test
  // has already closed its handle.
  second.db.close()
  let bare = bareDb()
  assertThrows(() => bare.prepare('select * from scenario'))
  let third = fixture()
  assertEquals(bare.isOpen, false)
  let fresh = freshDb()
  assertEquals(third.db.isOpen, false)
  fresh.close()
})

Deno.test('a failed scenario build is closed and retried, never cached', () => {
  let builds = 0
  let fixture = dbFixture((db) => {
    db.exec('create table scenario (value text)')
    if (++builds === 1) throw new Error('setup failed')
    return { builds }
  })
  assertThrows(fixture, Error, 'setup failed')
  let ready = fixture()
  assertEquals(ready.builds, 2)
  ready.db.close()
})
