// A child session's generated eid belongs to its reporter store, not intake's.
import { equal, test } from '@yaks/testing'
import { capture } from './report.ts'
import { ingest } from './intake.ts'
import { fixture } from './fixture_test.ts'
import { comp } from './model.ts'

test('intake preserves generated child session references from another store', async () => {
  let g = fixture()
  let child = 'child:3b21904a-b0fa-479b-8934-4286ae9c0cb1'
  let rows = capture(Error('broken'), {
    sink: () => {},
    during: { session: child },
    actor: { by: child, via: child },
  })
  await ingest(g, rows)
  await ingest(g, rows)
  let admitted = await g.read('.error ?during ?created')
  equal(admitted.length, 1)
  equal(comp(admitted[0], 'during').session, child)
  equal(comp(admitted[0], 'created').by, child)
})
