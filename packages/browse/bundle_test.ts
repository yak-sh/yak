import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import { bundle } from '@yaks/cli/page'

// Build the fixture while loading; the case checks the emitted module.
let js = await bundle(new URL('./main.tsx', import.meta.url))

test('the app bundles into one browser module', () => {
  assertEquals(/^import /m.test(js), false)
  assertEquals(js.length > 100_000, true)
})
