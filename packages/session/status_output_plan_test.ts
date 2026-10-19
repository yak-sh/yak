// Askless imports retain their whole turn, but ordinary past output does not
// contribute historical status facts. Reading that history stays inexpensive.
import { match, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { insert } from '@yaks/sql'
import { storage } from '@yaks/sqlite'
import { stepping } from '../sqlite/testing.ts'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { effectDoc } from '@yaks/effects'
import { archetypeDoc } from '@yaks/archetype/vocab'

let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  kernelDoc,
  effectDoc,
  archetypeDoc,
], [kernelKeywords])
for (let size of [100, 1000]) {
  let { driver: d, steps } = stepping()
  let s = storage(d, vocab, { derived: sessionDerived(vocab) })
  s.install()
  let shape = (id: number, names: string[]) => {
    d.query(insert('entity', { id, eid: `shape-${id}` }))
    d.query(insert('archetype', {
      entity: id,
      tables: JSON.stringify(names.sort()),
    }))
  }
  shape(10001, ['session'])
  shape(10002, ['content', 'entry'])
  shape(10003, ['content', 'entry', 'imported', 'output'])
  shape(10004, ['ask', 'attempt', 'entry'])
  d.query(
    insert(
      'entity',
      { id: 1, eid: 'owner', archetype: 10001 },
      { id: 2, eid: 'other', archetype: 10001 },
      { id: 3, eid: 'input', archetype: 10002 },
      { id: 4, eid: 'other-ask', archetype: 10004 },
    ),
  )
  d.query(
    insert('session', { entity: 1, id: 'owner' }, { entity: 2, id: 'other' }),
  )
  d.query(
    insert('entry', { entity: 3, session: 1, seq: 1 }, {
      entity: 4,
      session: 2,
      seq: 1,
    }),
  )
  d.query(insert('content', { entity: 3, body: 'input' }))
  d.query(insert('ask', { entity: 4, through: 4 }))
  d.query(insert('attempt', { entity: 4 }))
  for (let start = 0; start < size; start += 100) {
    let ids = Array.from({ length: 100 }, (_, i) => 10 + start + i)
    d.query(insert(
      'entity',
      ...ids.map((id) => ({
        id,
        eid: `entry-${id}`,
        archetype: 10003,
      })),
    ))
    d.query(insert(
      'entry',
      ...ids.map((entity, i) => ({
        entity,
        session: 1,
        seq: start + i + 2,
      })),
    ))
    d.query(insert('output', ...ids.map((entity) => ({ entity, source: 1 }))))
    d.query(
      insert('content', ...ids.map((entity) => ({ entity, body: 'prose' }))),
    )
    d.query(insert(
      'imported',
      ...ids.map((entity, i) => ({
        entity,
        source: 'fixture',
        line: start + i + 1,
      })),
    ))
  }
  // Execute once warm, counting engine work through the public named get.
  s.get(['owner'], ['session'])
  let before = steps()
  let rows = s.get(['owner'], ['session'])
  let vm = steps() - before
  let masked = s.get(['owner'], ['session'], {
    visibility: { components: { output: '!output' } },
  })
  test(`status aggregates ordinary imported output within its row budget (${size})`, () => {
    match(rows, [{ session: { status: 'settled' } }])
    match(masked, [{ session: { status: 'running' } }])
    ok(vm < size * 200 + 10000, `${vm} VM steps for ${size} outputs`)
  })
}
