// The series a session is numbered in when its run's `process` sits on the
// same entity: the session it is, never the process, whose letter is P.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { idKeywords, seriesOf } from '@yaks/id'
import { processDoc } from '@yaks/process'
import { loadVocab } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'

let vocab = loadVocab([sessionDoc, processDoc], [idKeywords])

test('a session that carries its process is numbered as the session', () => {
  let row = {
    entity: { eid: '7235e614-2fd8-411b-95a5-60746efdee1f' },
    session: {},
    process: {},
    exit: {},
  }
  assertEquals(vocab.kindOf(row), 'session')
  assertEquals(seriesOf(vocab)(['session', 'process', 'exit']), 'S')
})
