// Reading a transaction's own partial patch must not persist an intermediate
// classification that the final write immediately replaces.
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype'
import { storage } from './mod.ts'
import { mem, spy } from './testing.ts'
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    alpha: { component: true, type: 'object' },
    beta: { component: true, type: 'object' },
  },
}])
test('pending transaction reads cost no intermediate archetype writes', () => {
  let writes = 0
  let driver = spy(mem(), (sql) => {
    if (sql.startsWith('update "entity" set "archetype"')) writes++
  })
  let s = storage(driver, vocab)
  s.install()
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'owner' }, alpha: {} }])
    writes = 0
    equal(tx.read('.alpha').map((b) => b.entity.eid), ['owner'])
    equal(tx.read('!beta .alpha').map((b) => b.entity.eid), ['owner'])
    equal(writes, 0)
    tx.patch([{ entity: { eid: 'owner' }, beta: {} }])
    equal(tx.read('.alpha .beta').map((b) => b.entity.eid), ['owner'])
    equal(writes, 0)
  })
  equal(s.read('.alpha .beta').map((b) => b.entity.eid), ['owner'])
})

test('pending query shapes follow removals and nested rollback', () => {
  let s = storage(mem(), vocab)
  s.install()
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'a' }, alpha: {}, beta: {} },
      { entity: { eid: 'b' }, alpha: {} },
    ])
  )
  let ids = (rows: ReturnType<typeof s.read>) =>
    rows.map((b) => b.entity.eid).sort()
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'a' }, beta: null }])
    equal(ids(tx.read('.alpha !beta')), ['a', 'b'])
    tx.patch([{ entity: { eid: 'b' }, beta: {} }])
    equal(ids(tx.read('.alpha !beta')), ['a'])
    try {
      s.tx((inner) => {
        inner.patch([{ entity: { eid: 'a' }, alpha: null }])
        equal(ids(inner.read('.alpha !beta')), [])
        throw Error('undo')
      })
    } catch (e) {
      if (!(e instanceof Error) || e.message != 'undo') throw e
    }
    equal(ids(tx.read('.alpha !beta')), ['a'])
    equal(ids(tx.read('.alpha .beta')), ['b'])
  })
  equal(ids(s.read('.alpha !beta')), ['a'])
})
