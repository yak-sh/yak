// Each kind this package declares, written from its example into an empty
// graph, is named that kind.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { examplesAreTheirKinds } from '../ram/testing.ts'
import { builderDoc } from './vocab.ts'
import { taskDoc } from '@yaks/task/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'

test('each example is the kind it illustrates', () => {
  assertEquals(
    examplesAreTheirKinds([builderDoc, docDoc, taskDoc, toolsDoc, kernelDoc]),
    ['builder', 'agent_step'],
  )
})
