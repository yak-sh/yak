// Each kind this package declares, written from its example into an empty
// graph, is named that kind.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { topicDoc } from '@yaks/topic/vocab'
import { sessionDoc } from '@yaks/session/vocab'
import { examplesAreTheirKinds } from '../ram/testing.ts'
import { projectDoc } from './vocab.ts'

test('each example is the kind it illustrates', () => {
  assertEquals(
    examplesAreTheirKinds([projectDoc, docDoc, topicDoc, sessionDoc]),
    [
      'board',
      'project',
    ],
  )
})
