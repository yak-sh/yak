import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { fireLevel } from './bus.ts'

test('speech ducks fire alone, and restores it at rest', () => {
  assertEquals(fireLevel(false), 1)
  assertEquals(fireLevel(true), 0.22)
})

import { cry } from './voices.ts'

test('procedural creature cries stay quiet, with softer wandering calls', () => {
  for (let gait of ['walk', 'hop', 'drift', 'slide', 'hover']) {
    let bite = cry(gait, 1, true), call = cry(gait, 1, false)
    assert(bite.loud <= 0.025, `${gait}: bite cry too loud`)
    assert(call.loud <= 0.014, `${gait}: wandering cry too loud`)
    assert(call.loud < bite.loud)
    assert(bite.dur >= 0.4 && call.dur >= 0.4)
  }
})
