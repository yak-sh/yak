// Each kind this package declares, written from its example into an empty
// graph, is named that kind.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { examplesAreTheirKinds } from '../ram/testing.ts'
import { edgeDoc, edgeKeywords } from './vocab.ts'

// a relation for the example to be: @yaks/edge declares none of its own
let cites = { $defs: { cites: { component: true, edge: true } } }

test('each example is the kind it illustrates', () => {
  assertEquals(
    examplesAreTheirKinds([edgeDoc, cites, docDoc], [edgeKeywords]),
    ['edge'],
  )
})
