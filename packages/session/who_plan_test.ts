// Resolving a transcript's runner id must not scan unrelated transcripts.
import { equal, ok, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { stepping } from '../sqlite/testing.ts'
import { sessionDoc } from './comp.ts'
import { sessionFor } from './who.ts'

let vocab = loadVocab([sessionDoc, {
  $defs: { entity: { component: true, type: 'object' } },
}])
let cost = stepping()
let g = graph({ storage: storage(cost.driver, vocab), vocab })
await g.apply(Array.from({ length: 2000 }, (_, i) => ({
  entity: { eid: `session-${i}` },
  session: { id: `run-${i}` },
})))

test('an explicit session id lookup is bounded beside unrelated transcripts', async () => {
  let before = cost.steps()
  let row = await sessionFor(g, { id: 'run-1999' }, ['session.id'])
  let steps = cost.steps() - before
  equal(row?.entity.eid, 'session-1999')
  ok(steps < 200, `${steps} VM steps beside 2000 transcripts`)
})
