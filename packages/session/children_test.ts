// Admission of a root session: the cap counts the transcripts a runner is
// working on, over a store that reads `session.status` the way the fleet's does.

import { assertEquals, assertRejects } from '@std/assert'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { admit } from './children.ts'
import { ToolError } from './react.ts'
import { sessionDerived } from './status.ts'

let vocab = loadVocab([sessionDoc, toolsDoc])

Deno.test('the session cap counts transcripts being run, never empty ones', async () => {
  let s = storage(mem(), vocab, { derived: sessionDerived })
  s.install()
  let g = graph({ storage: s, vocab })
  // Sessions with no entries, as a harness's hooks record them by the
  // thousand.
  g.apply(
    ['a', 'b', 'c'].map((eid) => ({ entity: { eid }, session: { id: eid } })),
  )
  let start = () =>
    admit(g, undefined, { maxSessions: 1 }, () => Promise.resolve('ok'))
  assertEquals(await start(), 'ok')
  // One asked for a model's turn: that one is live, and fills the cap.
  g.apply([{
    entity: { eid: 'e1' },
    entry: { session: 'a', seq: 1 },
    content: { body: 'hi' },
    using: {},
  }], { trusted: true })
  await assertRejects(start, ToolError, 'live session cap (1) reached')
})
