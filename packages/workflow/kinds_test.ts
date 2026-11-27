// Each kind this package declares, written from its example into an empty
// graph, is named that kind.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc } from '@yaks/edge'
import { examplesAreTheirKinds } from '../ram/testing.ts'
import { workflowDoc } from './vocab.ts'

test('each example is the kind it illustrates', () => {
  assertEquals(examplesAreTheirKinds([workflowDoc, docDoc, edgeDoc]), [
    'step',
    'workflow',
  ])
})
