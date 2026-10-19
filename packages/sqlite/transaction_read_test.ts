// Transaction reads shape their result without narrowing predicate membership.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { val } from '@yaks/sql'
import { storage } from './mod.ts'
import { preparedDriver, snapshot } from './testing.ts'

let vocab = loadVocab([{
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
    summary: {
      component: true,
      properties: { value: { type: 'number', computed: true } },
    },
  },
}])
let s = storage(preparedDriver(snapshot(vocab)), vocab, {
  schemaReady: () => true,
  derived: { 'summary.value': { tag: 'number', expr: () => val(7) } },
})
s.tx((tx) =>
  tx.patch([{
    entity: { eid: 'one' },
    doc: { title: 'One' },
    summary: {},
  }])
)

test('transaction read projections retain full matching', () => {
  s.tx((tx) => {
    let [row] = tx.read('.doc.title=One', undefined, ['summary'])
    assertEquals(row.summary, { value: 7 })
    assertEquals(row.doc, undefined)
  })
})

test('transaction reads can select identity alone', () => {
  assertEquals(
    s.tx((tx) => tx.read('.doc', undefined, []))[0].summary,
    undefined,
  )
})

test('transaction reads retain whole bundles by default', () => {
  assertEquals(s.tx((tx) => tx.read('.doc'))[0].doc, { title: 'One' })
})

let pendingRows = s.tx((tx) => {
  tx.patch([{
    entity: { eid: 'fresh' },
    doc: { title: 'Fresh' },
    summary: {},
  }])
  return tx.read('.doc.title=Fresh', undefined, ['summary'])
})

test('transaction read projections see pending writes without exposing other components', () => {
  assertEquals(pendingRows[0].summary, { value: 7 })
  assertEquals(pendingRows[0].doc, undefined)
})

test('transaction read projections preserve visibility', () => {
  assertEquals(
    s.tx((tx) =>
      tx.read('.doc', { visibility: { entity: '.entity.eid=missing' } }, [])
    ),
    [],
  )
})
