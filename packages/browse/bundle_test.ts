import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import { bundle } from '@yaks/cli/page'

test('the app bundles into one browser module', async () => {
  let js = await bundle(new URL('./main.tsx', import.meta.url))
  assertEquals(/^import /m.test(js), false)
  assertEquals(js.length > 100_000, true)
})
