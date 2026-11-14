// Each kind this package declares, written from its example into an empty
// graph, is named that kind.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { secretsDoc } from '@yaks/secrets/vocab'
import { examplesAreTheirKinds } from '../ram/testing.ts'
import { connectionsDoc } from './vocab.ts'

test('each example is the kind it illustrates', () => {
  assertEquals(examplesAreTheirKinds([connectionsDoc, docDoc, secretsDoc]), [
    'integration',
    'connection',
  ])
})
