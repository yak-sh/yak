import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { lit } from '@yaks/sql'
import { storage } from './mod.ts'
import { reader } from './reader.ts'
import { mem } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    record: {
      component: true,
      properties: {
        title: { type: 'string', index: true },
        input: { type: 'string' },
      },
    },
  },
})
let fixture = () => {
  let d = mem(), store = storage(d, vocab)
  store.install()
  store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'one' }, record: { title: 'kept', input: 'old' } },
    ])
  )
  return { d, store, readOnly: reader(d, vocab) }
}
let dropped = fixture(), unindexed = fixture(), grown = fixture()
// Prime both read paths before the schema moves, as a waiter would.
for (let f of [dropped, unindexed, grown]) {
  f.store.read('.record.title=kept')
  f.readOnly.read('.record.title=kept')
}
dropped.d.query({ t: 'alter table', table: 'record', drop: 'input' })
unindexed.d.query({ t: 'drop', kind: 'index', name: 'record_title' })
grown.d.query({ t: 'alter table', table: 'record', drop: 'input' })
grown.store.get(['one'])
grown.readOnly.get(['one'])
grown.d.query({
  t: 'alter table',
  table: 'record',
  add: { name: 'input', type: 'text' },
})
grown.d.query({
  t: 'update',
  table: 'record',
  set: { input: lit('new') },
})

for (let mode of ['store', 'readOnly'] as const) {
  test(`${mode}: a retained reader survives a dropped property`, () => {
    assertEquals(dropped[mode].get(['one'])[0].record, {
      title: 'kept',
    })
  })
  test(`${mode}: a query survives a dropped property`, () => {
    assertEquals(dropped[mode].read('.record.title=kept')[0].record, {
      title: 'kept',
    })
  })
  test(`${mode}: a declared index can disappear between reads`, () => {
    assertEquals(unindexed[mode].read('.record.title=kept')[0].record, {
      title: 'kept',
      input: 'old',
    })
  })
  test(`${mode}: a missing column override expires when the column returns`, () => {
    assertEquals(grown[mode].get(['one'])[0].record, {
      title: 'kept',
      input: 'new',
    })
  })
}
