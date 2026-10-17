import { equal, test } from '@yaks/testing'
import { derivedEid } from '@yaks/graph/identity'
import { legacyEid, replacer, structural, validEid } from './migrate-eids.ts'

let call = '12345678-1234-4234-8234-123456789abc'
let child = 'child:' + call, nextChild = derivedEid(child)
let mapping = new Map([[child, nextChild], [
  'repair',
  derivedEid('migrated-eid|repair'),
]])
let replace = replacer(mapping)

test('rekey dependent input and receipt use the new session address', () => {
  equal(legacyEid(child, replace), nextChild)
  equal(legacyEid(child + ':input', replace), derivedEid(nextChild + ':input'))
  equal(
    legacyEid('notice:' + child, replace),
    derivedEid('notice:' + nextChild),
  )
  equal(
    legacyEid('delivery:' + child + ':task:' + call + ':done', replace),
    derivedEid('delivery:' + nextChild + ':task:' + call + ':done'),
  )
  equal(validEid(nextChild), true)
  equal(validEid(child), false)
  equal(validEid('a'.repeat(40)), true)
  equal(validEid('a'.repeat(64)), true)
  equal(validEid('repair'), false)
})

test('structured address rewriting preserves user prose and command text', () => {
  let before = {
    session: child,
    prompt: child,
    body: 'repair',
    command: 'repair',
    q: '.entry.session=' + child,
    args: { eid: child, prompt: 'repair', query: '.created.via=' + child },
    tasks: { [child]: { doc: { body: 'repair' } } },
    content: { body: child },
  }
  equal(structural(before, mapping), {
    session: nextChild,
    prompt: child,
    body: 'repair',
    command: 'repair',
    q: '.entry.session=' + nextChild,
    args: {
      eid: nextChild,
      prompt: 'repair',
      query: '.created.via=' + nextChild,
    },
    tasks: { [nextChild]: { doc: { body: 'repair' } } },
    content: { body: child },
  })
})

import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { mem } from '../packages/sqlite/testing.ts'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype'
import { migrateEids } from './migrate-eids.ts'
let collisionVocab = loadVocab([archetypeDoc, {
  $defs: {
    marker: {
      component: true,
      type: 'object',
      properties: { value: { type: 'string' } },
    },
  },
}])
let collisionDb = mem()
let collisionStore = storage(collisionDb, collisionVocab)
collisionStore.install()
let collisionGraph = graph({ storage: collisionStore, vocab: collisionVocab })
await collisionGraph.apply([
  { entity: { eid: child }, marker: { value: 'stale callback' } },
  { entity: { eid: nextChild }, marker: { value: 'canonical' } },
], { trusted: true })
collisionDb.query({
  t: 'create table',
  name: 'journal_field',
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'change', type: 'integer' },
    { name: 'field', type: 'text' },
    { name: 'value', type: 'text' },
  ],
})
collisionDb.query({
  t: 'create table',
  name: 'journal_change',
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'component', type: 'text' },
  ],
})
let collisionProof = migrateEids(collisionDb, collisionVocab, true)
let collisionRows = await collisionGraph.read('.marker *')
test('a recreated legacy address never overwrites its already migrated canonical row', () => {
  equal(collisionProof.invalidAfter, 0)
  equal(collisionProof.moved, 1)
  equal(collisionRows.length, 2)
  equal(collisionRows.find((r) => r.entity.eid == nextChild)?.marker, {
    value: 'canonical',
  })
  equal(
    collisionRows.find((r) =>
      r.entity.eid == derivedEid('migrated-eid|' + child)
    )?.marker,
    { value: 'stale callback' },
  )
})
