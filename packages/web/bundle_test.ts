import './testing.ts'
import { assertEquals } from '@std/assert'
import { bundle } from './bundle.ts'

Deno.test('the app bundles into one browser module', async () => {
  let js = await bundle()
  assertEquals(/^import /m.test(js), false)
  assertEquals(js.length > 100_000, true)
})
