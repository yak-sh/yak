import { assertEquals, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { cleared, restored } from './fight-update.ts'
import type { Bundle } from '@yaks/graph'

let row = (dealt: unknown): Bundle => ({
  entity: { eid: 'hero' },
  fight: { dealt, swing: 4 },
  doc: { body: 'precious input' },
})
test('fight movement refuses every malformed source before offering a clear', () => {
  for (let value of ['garbage', '{}', '[null]', '[{"foe":"wolf"}]', 3]) {
    assertThrows(() =>
      cleared([row('[]'), { ...row(value), entity: { eid: 'bad' } }])
    )
  }
  assertThrows(() => cleared([row('[]'), row('[]')]), Error, 'duplicate')
  assertEquals(cleared([{ ...row(null), fight: {} }]), [])
})
test('fight restore refuses concurrent changes and keeps the whole parsed array', () => {
  let text = '[{"foe":"wolf","life":0,"dmg":1,"held":2,"extra":"keep"}]'
  let before = [row(text)]
  assertEquals(cleared(before)[0].fight, { dealt: null })
  assertEquals(restored(before, [row(undefined)])[0].fight, {
    dealt: JSON.parse(text),
  })
  assertEquals(restored(before, [row(JSON.parse(text))]), [])
  assertEquals(restored(before, [row(undefined)], true)[0].fight, {
    dealt: text,
  })
  assertThrows(() => restored(before, [row([])]), Error, 'do not overwrite')
  assertThrows(() => restored(before, []), Error, 'do not resurrect')
  assertThrows(
    () => restored(before, [{ ...row(undefined), fight: { swing: 5 } }]),
    Error,
    'fight changed',
  )
})
