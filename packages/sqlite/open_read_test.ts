// File-backed operations use installed schema only. These scratch files prove
// that querying neither installs nor repairs it, even with another writer.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { as, fn, scan, select } from '@yaks/sql'
import { open, type Opened } from './db.ts'
import { storage } from './mod.ts'
import { objects } from './physical.ts'
import { shop } from './testing.ts'

let changes = (db: Opened) =>
  db.query(select({ cols: [as(fn('total_changes'), 'n')] }))[0].n
let schema = (db: Opened) => scan(db, 'sqlite_schema')

// The directory owns the database and WAL sidecars; neither survives a test.
let scratch = () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yak-open-read-' })
  let path = `${dir}/graph.db`
  let peers: Opened[] = []
  return {
    open: (readOnly = false) => {
      let db = open(path, { readOnly })
      db.query({ t: 'pragma', name: 'busy_timeout', value: 0 })
      peers.push(db)
      return db
    },
    [Symbol.dispose]: () => {
      for (let db of peers.toReversed()) db.close()
      Deno.removeSync(dir, { recursive: true })
    },
  }
}

test('a query on an uninstalled file fails without creating schema or rows', () => {
  using f = scratch()
  let db = f.open()
  let before = schema(db), written = changes(db)
  let store = storage(db, shop)
  assertThrows(() => store.read('.doc'), Error, 'no such table')
  assertEquals(schema(db), before)
  assertEquals(changes(db), written)
  // A write cannot silently become the graph's schema installer either.
  assertThrows(
    () =>
      store.tx((tx) =>
        tx.patch([{ entity: { eid: 'one' }, doc: { title: 'A' } }])
      ),
    Error,
    'no such table',
  )
  assertEquals(schema(db), before)
  assertEquals(changes(db), written)
  store.install()
  assertEquals(store.read('.doc'), [])
})

test('a current file can be queried read-only while another connection holds the write lock', () => {
  using f = scratch()
  let writer = f.open()
  let made = storage(writer, shop)
  made.install()
  made.tx((tx) => tx.patch([{ entity: { eid: 'one' }, doc: { title: 'A' } }]))
  let db = f.open(true)
  let before = schema(db), written = changes(db)
  writer.query({ t: 'begin', mode: 'immediate' })
  try {
    // Construct the reader under the lock: first use cannot install either.
    let store = storage(db, shop)
    assertEquals(store.read('.doc.title=A')[0].doc, { title: 'A', body: null })
    assertEquals(store.get(['one'], ['doc'])[0].doc, { title: 'A', body: null })
    assertEquals(store.rows('.doc .count'), [{ value: '', n: 1 }])
    assertEquals(schema(db), before)
    assertEquals(changes(db), written)
  } finally {
    writer.query({ t: 'rollback' })
  }
})

test('file reads leave external schema edits alone; explicit installation repairs them', () => {
  using f = scratch()
  let db = f.open(), peer = f.open()
  let store = storage(db, shop)
  store.install()
  store.tx((tx) => tx.patch([{ entity: { eid: 'one' }, doc: { title: 'A' } }]))
  // Establish a reader before the external edit, and another after it.
  assertEquals(store.get(['one'], ['doc'])[0].doc, { title: 'A', body: null })
  peer.query({ t: 'drop', kind: 'index', name: 'product_sku' })
  let before = schema(db), written = changes(db)
  for (let reader of [store, storage(db, shop)]) {
    assertEquals(reader.read('.doc.title=A')[0].doc, { title: 'A', body: null })
    assertEquals(objects(db, { name: 'product_sku' }), [])
    assertEquals(schema(db), before)
    assertEquals(changes(db), written)
  }
  store.install()
  assertEquals(objects(db, { name: 'product_sku' }).length, 1)
  assertEquals(store.get(['one'], ['doc'])[0].doc, { title: 'A', body: null })
})
