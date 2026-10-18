// A child session's generated eid belongs to its reporter store, not intake's.
import { equal, test } from '@yaks/testing'
import { derivedEid } from '@yaks/graph/identity'
import { capture } from './report.ts'
import { ingest } from './intake.ts'
import { fixture } from './fixture_test.ts'
import { comp } from './model.ts'

let g = fixture(), reporter = fixture()
// Delegation derives a UUID from the originating call, not a word address.
let child = derivedEid('child:3b21904a-b0fa-479b-8934-4286ae9c0cb1')
await reporter.apply([{
  entity: { eid: child },
  doc: { title: 'Reporter child' },
}])
let absent = await g.get([child])
let rows = capture(Error('broken'), {
  sink: () => {},
  during: { session: child },
  actor: { by: child, via: child },
})
await ingest(g, rows)
await ingest(g, rows)
let admitted = await g.read('.error ?during ?created')
let [origin] = await reporter.get([child])
let [reference] = await g.get([child])

test('intake preserves generated child session references from another store', () => {
  equal(absent, [])
  equal(admitted.length, 1)
  equal(comp(admitted[0], 'during').session, child)
  equal(comp(admitted[0], 'created').by, child)
  equal(comp(admitted[0], 'created').via, child)
  equal(origin.doc, { title: 'Reporter child' })
  equal(reference?.doc, undefined)
})
