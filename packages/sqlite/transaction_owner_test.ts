import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { preparedDriver, snapshot } from './testing.ts'
import { storage } from './mod.ts'
import { statements } from './statements.ts'
import { col, select, table } from '@yaks/sql'

let vocab = loadVocab([{
  $defs: {
    note: { component: true, properties: { text: { type: 'string' } } },
  },
}])
let make = () => {
  let driver = preparedDriver(snapshot(vocab))
  return { driver, store: storage(driver, vocab, { schemaReady: () => true }) }
}
let patch = (eid: string) => [{ entity: { eid }, note: { text: eid } }]

let independent = await (async () => {
  let { driver, store } = make()
  let release = Promise.withResolvers<void>()
  let first = store.tx(async (tx) => {
    tx.patch(patch('rolled-back'))
    await release.promise
    throw new Error('undo first')
  })
  let failed = assertRejects(() => Promise.resolve(first), Error, 'undo first')
  let second = store.tx((tx) => tx.patch(patch('committed')))
  release.resolve()
  await failed
  await second
  let rows = store.get(['rolled-back', 'committed'])
  driver[Symbol.dispose]()
  return rows.map((b) => b.entity.eid)
})()

test('an independent write commits after an asynchronous transaction rolls back', () => {
  equal(independent, ['committed'])
})

let nested = await (async () => {
  let { driver, store } = make()
  await store.tx(async (tx) => {
    tx.patch(patch('outer'))
    await Promise.resolve()
    try {
      await store.tx(async (inner) => {
        inner.patch(patch('inner'))
        await Promise.resolve()
        throw new Error('undo savepoint')
      })
    } catch { /* the outer transaction remains usable */ }
    tx.patch(patch('last'))
  })
  let rows = store.get(['outer', 'inner', 'last'])
  driver[Symbol.dispose]()
  return rows.map((b) => b.entity.eid)
})()

test('a nested asynchronous rollback preserves its own outer transaction', () => {
  equal(nested, ['outer', 'last'])
})

let atomic = await (async () => {
  let { driver, store } = make()
  let sql = statements(driver)
  let release = Promise.withResolvers<void>()
  let first = store.tx(async (tx) => {
    tx.patch(patch('first'))
    await release.promise
    throw new Error('undo graph')
  })
  let failed = assertRejects(() => Promise.resolve(first))
  let second = sql.atomic(() => {
    // Use the same adapter as a plugin beside the graph, in its own unit.
    store.tx((tx) => tx.patch(patch('index')))
    return sql.query(select({ cols: [col('text')], from: table('note') }))
  })
  release.resolve()
  await failed
  await second
  let rows = store.get(['index'])
  driver[Symbol.dispose]()
  return rows.map((b) => b.entity.eid)
})()

test('statement units and graph writes share one transaction owner', () => {
  equal(atomic, ['index'])
})
