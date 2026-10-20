// A kept answer to a query with a disjunction stands across a write its
// query selects neither before nor after, as a conjunction's does.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { open } from './db.ts'
import { storage } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
}])
let d = open(':memory:'), s = storage(d, vocab)
s.install()
let query = d.query, reads = 0
d.query = (stmt) => {
  if (stmt.t == 'select' || stmt.t == 'raw') reads++
  return query(stmt)
}
let g = graph({ vocab, storage: s })
await g.apply([
  { entity: { eid: 'a' }, doc: { title: 'a' } },
  { entity: { eid: 'b' }, doc: { title: 'b' } },
])
let q = ".doc.title='a' | .doc.title='b'"
let eids = async () => (await g.read(q)).map((b) => b.entity.eid).sort()
// Asked twice, the answer is kept.
await eids()
await eids()
await g.apply([{ entity: { eid: 'c' }, doc: { title: 'c' } }])
let before = reads, unrelated = await eids(), asked = reads - before
await g.apply([{ entity: { eid: 'c' }, doc: { title: 'a' } }])
let related = await eids()

test('a disjunction keeps its answer across a write it never selects', () => {
  equal(unrelated, ['a', 'b'])
  equal(asked, 0)
})

test('a disjunction answers again once a write joins it', () =>
  equal(related, ['a', 'b', 'c']))
