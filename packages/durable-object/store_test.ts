/// <reference lib="deno.ns" />
// The store over the object's own SQLite: the schema installs, a batch lands,
// and the two things the runtime is strict about — what may be bound, and who
// owns a transaction — hold. The stand-in refuses anything workerd would, so
// each of these fails loudly rather than only in production.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { type Bundle, match, reads } from '@yaks/graph'
import { blobKeywords, blobRead, blobSchema } from '@yaks/blob'
import { insert } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { durable, shop, store } from './testing.ts'
import { driver } from './sql.ts'
import { storage } from './store.ts'
import { kitchen, PROJECTED, PROJECTED_ROW, RECIPE } from '../sqlite/testing.ts'

let comp = (b: Bundle, name: string) => b[name] as Record<string, unknown>

test('install is idempotent, and a bundle survives the round trip', () => {
  let s = store()
  s.install() // create-if-not-exists: a woken object may call it every time
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'p1' },
      doc: { title: 'Kettle' },
      product: { price: 40, available: true, status: 'live' },
    }])
  )
  let [p] = s.read('.kind=product') as Bundle[]
  assertEquals(p.entity.eid, 'p1')
  assertEquals(comp(p, 'doc').title, 'Kettle')
  // A boolean would bind as the text 'true'; it lands as the 1 the column holds
  // and reads back as the boolean written.
  assertEquals(comp(p, 'product').available, true)
})

test('an object and an array come back as the values written', () => {
  let s = store(kitchen)
  s.tx((tx) => tx.patch([{ entity: { eid: 'r1' }, recipe: RECIPE }]))
  let [read] = s.read('.recipe') as Bundle[]
  let [got] = s.tx((tx) => tx.get(['r1']))
  assertEquals([read.recipe, got.recipe], [RECIPE, RECIPE])
})

test('a projected boolean reads back as true or false', () => {
  let s = store(kitchen)
  s.tx((tx) => tx.patch([{ entity: { eid: 'r1' }, recipe: RECIPE }]))
  assertEquals(s.rows(PROJECTED), [PROJECTED_ROW])
})

test('a hosted blob-backed binding projects text at every collection level', () => {
  let vocab = loadVocab({
    $defs: {
      doc: {
        component: true,
        properties: { body: { type: 'string', store: 'blob' } },
      },
    },
  }, [blobKeywords])
  let held = durable()
  let sql = driver(held)
  for (let stmt of blobSchema()) sql.query(stmt)
  let s = storage(held, vocab, { derived: blobRead(vocab) })
  s.install()
  s.tx((tx) => tx.patch([{ entity: { eid: 'd' }, doc: { body: 'address' } }]))
  sql.query(insert('blob_text', { sha: 'address', value: 'hosted prose' }))
  let flat = match('$d .doc, doc.body=$description')
  let nested = match('[$d .doc, doc.body=$description]')
  let found = s.tx((tx) => tx.bindings([flat, nested], [], reads(flat, vocab)))
  assertEquals(s.read('.doc')[0].doc, { body: 'hosted prose' })
  assertEquals(found[0][0].vars, { d: 'd', description: 'hosted prose' })
  assertEquals(found[1][0].collections?.[0].members[0].vars, {
    d: 'd',
    description: 'hosted prose',
  })
})

test('bytes go in as an ArrayBuffer and come back as bytes', () => {
  let s = store()
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'd1' },
      doc: { body: new Uint8Array([1, 2, 3]) },
    }])
  )
  let [d] = s.tx((tx) => tx.get(['d1']))
  assertEquals(comp(d, 'doc').body, new Uint8Array([1, 2, 3]))
})

test("the transaction is the runtime's, and it rolls back", () => {
  let s = store()
  assertThrows(() =>
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Kettle' } }])
      throw new Error('no')
    })
  )
  assertEquals(s.read('.kind=doc'), [])
})

test('a value the engine will not take never reaches it', () => {
  // The stand-in throws on anything but an ArrayBuffer, string, number or
  // null — so this passing is the proof the driver converts.
  let s = storage(durable(), shop)
  s.install()
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'p1' },
      product: { price: 1, available: false },
    }])
  )
  assert(s.read('.product.available=0').length == 1)
})
