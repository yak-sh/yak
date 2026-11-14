// Each kind this package declares, written from its example into an empty
// graph, is named that kind.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { builderDoc } from '@yaks/builders/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { examplesAreTheirKinds } from '../ram/testing.ts'
import { dreamingDoc } from './vocab.ts'

test('each example is the kind it illustrates', () => {
  assertEquals(examplesAreTheirKinds([dreamingDoc, builderDoc, docDoc]), [
    'dream',
  ])
})
