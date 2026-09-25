// Admission of a root session: the cap counts the transcripts a runner is
// working on, over a store that reads `session.status` the way the fleet's does.

import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { admit } from './children.ts'
import { ToolError } from './react.ts'
import { sessionDerived } from './status.ts'

let vocab = loadVocab([sessionDoc, toolsDoc])

let entry = (session: string, seq: number, kind: object): Bundle => ({
  entity: { eid: `${session}${seq}` },
  entry: { session, seq },
  ...kind,
})

// Each transcript beside the cap of 1, and whether it fills it.
let shapes: [string, Bundle[], boolean][] = [
  ['no entries, as a harness hook records it', [], false],
  [
    'run outside the graph',
    [entry('s', 1, { content: { body: 'hi' } })],
    false,
  ],
  ['asking the daemon for a model turn', [
    entry('s', 1, { content: { body: 'hi' }, using: {} }),
  ], true],
  ['a turn the daemon is taking', [entry('s', 1, { ask: {} })], true],
]

Deno.test('the session cap counts the transcripts the daemon is running', async () => {
  for (let [name, entries, fills] of shapes) {
    let s = storage(mem(), vocab, { derived: sessionDerived })
    s.install()
    let g = graph({ storage: s, vocab })
    g.apply([{ entity: { eid: 's' }, session: { id: 's' } }, ...entries], {
      trusted: true,
    })
    let start = () =>
      admit(g, undefined, { maxSessions: 1 }, () => Promise.resolve('ok'))
    if (fills) {
      await assertRejects(start, ToolError, 'live session cap (1) reached')
    } else assertEquals(await start(), 'ok', name)
  }
})
