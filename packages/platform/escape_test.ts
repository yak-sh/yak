import { assertEquals } from '@std/assert'
import { esc, unesc } from './escape.ts'

Deno.test('unesc reads back what esc wrote, and numeric references', () => {
  let said = `Tom & Jerry's <"show">`
  assertEquals(unesc(esc(said)), said)
  assertEquals(unesc('caf&#233; &#x2014; &nbsp;'), 'café —  ')
  assertEquals(unesc('&copy; stays'), '&copy; stays')
})
