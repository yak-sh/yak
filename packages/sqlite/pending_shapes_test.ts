import { equal, test } from '@yaks/testing'
import { col, eq, val } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { ledger, pendingShapes } from './archetype.ts'
import { storage } from './mod.ts'
import { mem } from './testing.ts'

let vocab = loadVocab([{
  $defs: Object.fromEntries(
    ['doc', 'task', 'note'].map((name) => [name, {
      component: true,
      type: 'object',
    }]),
  ),
}])

let fixture = () => {
  let d = mem(), calls = 0
  let query = d.query.bind(d)
  d.query = (s) => (calls++, query(s))
  let store = storage(d, vocab)
  store.install()
  store.tx((tx) => tx.patch([{ entity: { eid: 'a' }, doc: {} }]))
  let book = ledger(d)
  let read = () => pendingShapes(d, book)
  let names = () => [...read().values()].map((v) => [...v].sort())
  return { d, store, book, read, names, calls: () => calls }
}

let reused = fixture(), rolled = fixture(), changed = fixture()

test('pending shapes reuse their pointer read until the rows or ledger change', () => {
  let { d, store, read, names, calls } = reused
  store.tx((tx) => {
    tx.patch([{ entity: { eid: 'a' }, task: {} }])
    let before = calls()
    equal(names(), [['doc', 'task']])
    equal(calls() - before, 1)
    before = calls()
    equal(names(), [['doc', 'task']])
    equal(calls() - before, 0)

    // Another handle hears a pending move before its SQL is written.
    let peer = ledger(d)
    peer.moved('a', 'note', true)
    equal(names(), [['doc', 'note', 'task']])
    peer.moved('a', 'note', false)
    equal(names(), [['doc', 'task']])

    tx.patch([{ entity: { eid: 'a' }, task: null, note: {} }])
    equal(names(), [['doc', 'note']])
  })
  equal([...read()], [])
})

test('pending shape reuse does not retain a rolled back component', () => {
  let { d, store, names } = rolled
  store.tx((tx) => {
    tx.patch([{ entity: { eid: 'a' }, task: {} }])
    equal(names(), [['doc', 'task']])
    d.query({ t: 'savepoint', name: 'inner' })
    tx.patch([{ entity: { eid: 'a' }, note: {} }])
    equal(names(), [['doc', 'note', 'task']])
    d.query({ t: 'rollback', to: 'inner' })
    d.query({ t: 'release', name: 'inner' })
    equal(names(), [['doc', 'task']])
  })
})

test('pending shapes hear driver writes and their rollback without ledger moves', () => {
  let { d, store, names } = changed
  store.tx((tx) => {
    tx.patch([{ entity: { eid: 'a' }, task: {} }])
    equal(names(), [['doc', 'task']])
    d.query({ t: 'savepoint', name: 'rename' })
    d.query({
      t: 'update',
      table: 'entity',
      set: { eid: val('b') },
      where: eq(col('eid'), val('a')),
    })
    equal(names(), [])
    d.query({ t: 'rollback', to: 'rename' })
    d.query({ t: 'release', name: 'rename' })
    equal(names(), [['doc', 'task']])
  })
})
