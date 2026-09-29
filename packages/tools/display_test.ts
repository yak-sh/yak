// Command answers keep structured data while people get readable fields.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { display } from './display.ts'

Deno.test('query rows read as Markdown fields with their values intact', () => {
  let answer = [{
    entity: { eid: 'hero-1' },
    player: { name: 'Ada *the brave*', level: 7 },
  }]
  let said = display(answer)
  assertStringIncludes(said, '#### Result 1')
  assertStringIncludes(said, '**player\\.name**: `"Ada *the brave*"`')
  assertStringIncludes(said, '**player\\.level**: `7`')
  assertEquals(said.includes('"player": {'), false)
  assertEquals(display([]), 'No rows.')
})
