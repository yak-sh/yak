import { equal, test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { preparedDriver, snapshot } from '../sqlite/testing.ts'
import { storage } from '../sqlite/mod.ts'
import { compile, screen, sourceScreen } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    link: {
      component: true,
      properties: { to: { type: 'string', ref: 'entity' } },
    },
  },
})
let driver = preparedDriver(snapshot(vocab))
let store = storage(driver, vocab, { schemaReady: () => true })
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'target' } },
    { entity: { eid: 'one' }, link: { to: 'target' } },
    { entity: { eid: 'two' }, link: { to: 'one' } },
  ])
)
let query = parse('.link.to=target')
let opts = { references: { target: null } }

test('an unresolved reference selector answers its known empty rows', () => {
  let compiled = compile(query, vocab, opts)
  equal(compiled.answer, [])
  equal(driver.query(compiled), [])
})
test('an empty reference selection still answers its aggregate', () => {
  equal(store.rows('.link.to=target .count', opts), [{ value: '', n: 0 }])
})
test('an empty reference arm leaves the other disjunct selected', () => {
  equal(store.rows('.link.to=target|.entity.eid=two', opts), [{ eid: 'two' }])
})
test('an empty reference selector remains a valid identity screen', () => {
  equal(driver.query(screen(query, vocab, opts)!), [])
})
test('an empty reference policy remains a valid source screen', () => {
  equal(
    driver.query(
      sourceScreen(vocab, {
        ...opts,
        visibility: { entity: query },
      })!,
    ),
    [],
  )
})
