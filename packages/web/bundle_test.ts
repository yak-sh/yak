import { assertEquals } from '@std/assert'
import { slow } from './testing.ts'
import { bundle } from './bundle.ts'

slow('the app bundles into one browser module', async () => {
  let js = await bundle()
  assertEquals(/^import /m.test(js), false)
  assertEquals(js.length > 100_000, true)
})
