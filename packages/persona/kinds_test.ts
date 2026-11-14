// Each kind this package declares, written from its example into an empty
// graph, is named that kind.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { examplesAreTheirKinds } from '../ram/testing.ts'
import { personaDoc } from './vocab.ts'

test('each example is the kind it illustrates', () => {
  assertEquals(examplesAreTheirKinds([personaDoc, docDoc, toolsDoc]), [
    'person',
    'persona',
    'skill',
  ])
})
