// The letter a session is shown by when its run's `process` sits on the same
// entity: the session it is, never the process, whose letter is P.

import { assertEquals } from '@std/assert'
import { human } from '@yaks/id'
import { processDoc } from '@yaks/process'
import { loadVocab } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'

let vocab = loadVocab([sessionDoc, processDoc])

Deno.test('a session that carries its process is shown as the session', () => {
  let row = {
    entity: { eid: '7235e614-2fd8-411b-95a5-60746efdee1f', num: 16765 },
    session: {},
    process: {},
    exit: {},
  }
  assertEquals(vocab.kindOf(row), 'session')
  assertEquals(human(vocab)(row), 'S-16765')
})
