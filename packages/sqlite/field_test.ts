// A component may name its referenced work `entity`, independently of its
// owner. The storage projection cannot reserve the person's vocabulary.

import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { match } from '@yaks/graph'
import { storage } from './mod.ts'
import { mem, seed } from './testing.ts'
import { bindings } from './rules.ts'

let vocab = loadVocab({
  $defs: {
    entity: {
      component: true,
      type: 'object',
      properties: {
        eid: { type: 'string' },
      },
    },
    during: {
      component: true,
      type: 'object',
      properties: {
        entity: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
  },
})

test('entity-named properties write, filter, project, overlay and reopen', () => {
  let driver = mem()
  let s = storage(driver, vocab)
  s.install()
  seed(s, [
    { entity: { eid: 'a' } },
    { entity: { eid: 'b' } },
    { entity: { eid: 'error' }, during: { entity: 'a' } },
  ])
  equal(s.read('.during.entity=a')[0].during, { entity: 'a' })
  equal(s.rows('.during .fields=during.entity')[0]['during.entity'], 'a')
  s.tx((tx) =>
    tx.patch([{ entity: { eid: 'error' }, during: { entity: 'b' } }])
  )
  equal(s.read('.during.entity=b')[0].during, { entity: 'b' })
  let [rows] = bindings(driver, vocab, [match('.during.entity=a')], [{
    entity: { eid: 'error' },
    during: { entity: 'a' },
  }], ['during'])
  equal(rows.length, 1)
  s.install()
  equal(s.read('.during.entity=b')[0].during, { entity: 'b' })
})
