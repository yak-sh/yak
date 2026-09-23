// The store's own key/value, and the epoch minted on top of it.

import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { META, schema } from './ddl.ts'
import { EPOCH, epoch, meta } from './meta.ts'
import { storage } from './mod.ts'
import type { Driver } from './driver.ts'
import { mem, shop } from './harness.ts'

// A store over a fresh database, installed — what a host has after boot.
let installed = (d: Driver = mem()) => {
  storage(d, shop).install()
  return d
}

// The table as the live database holds it, straight out of sqlite_master.
let master = (d: Driver) =>
  d.query(`select sql from sqlite_master where name = ?`, [META])[0]?.sql as
    | string
    | undefined

Deno.test('the meta table is raised with the spine', () => {
  assert(
    schema(shop).some((s) => s.includes(`create table if not exists ${META}`)),
    'no meta table in the schema',
  )
  assert(master(installed()), 'the installed database has no meta table')
})

Deno.test('meta: set, get, overwrite, delete', () => {
  let m = meta(installed())
  assertEquals(m.get('sweep'), undefined)
  m.set('sweep', '2026-09-15T00:00:00Z')
  assertEquals(m.get('sweep'), '2026-09-15T00:00:00Z')
  m.set('sweep', 'later')
  assertEquals(m.get('sweep'), 'later')
  m.del('sweep')
  assertEquals(m.get('sweep'), undefined)
  m.del('sweep') // clearing what is not there is a no-op, not an error
})

Deno.test('meta: keys are independent and values keep their text', () => {
  let m = meta(installed())
  m.set('a', '1')
  m.set('b', '')
  assertEquals([m.get('a'), m.get('b')], ['1', ''])
  m.del('a')
  assertEquals([m.get('a'), m.get('b')], [undefined, ''])
})

Deno.test('meta: a value with a quote rides as a bind, not a literal', () => {
  let m = meta(installed())
  m.set("it's", "o'clock")
  assertEquals(m.get("it's"), "o'clock")
})

Deno.test('epoch: minted by install, stable, and its own per store', () => {
  let d = installed()
  let minted = meta(d).get(EPOCH)
  assert(minted, 'install minted no epoch')
  assertEquals(epoch(d), minted) // a second ask reads, never re-mints
  storage(d, shop).install() // and a second install leaves it alone
  assertEquals(meta(d).get(EPOCH), minted)
  assertNotEquals(epoch(installed()), minted) // a different store, its own
})

Deno.test('epoch: mints on a store whose row was stripped', () => {
  let d = installed()
  meta(d).del(EPOCH)
  assertEquals(meta(d).get(EPOCH), undefined)
  let again = epoch(d)
  assert(again)
  assertEquals(meta(d).get(EPOCH), again)
})

Deno.test('install adopts a server_meta the host already raised', () => {
  let d = mem()
  // The table as a host raised it before this package.
  d.exec(`create table if not exists server_meta (
    k text primary key,
    v text not null
  )`)
  d.exec(`insert into server_meta (k, v) values ('epoch', 'held')`)
  let before = master(d)
  storage(d, shop).install()
  // Same table, untouched — not a second one, not a rewritten one.
  assertEquals(master(d), before)
  // And the rows it already held are still the store's answers.
  assertEquals(epoch(d), 'held')
  assertEquals(meta(d).get(EPOCH), 'held')
})
