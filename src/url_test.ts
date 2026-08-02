// Public entity links have one origin and speak the current path grammar.
import { assertEquals } from '@std/assert'
import { entityUrl } from './url.ts'

Deno.test('entity links use the public board and direct id path', () => {
  assertEquals(entityUrl('T-42'), 'https://tasks.yak.sh/T-42')
})
