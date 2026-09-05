// What a person types, spelled safely for FTS5.

import { assertEquals } from '@std/assert'
import { term } from './term.ts'

Deno.test('a word or a phrase is quoted, so every character is literal', () => {
  assertEquals(term('dragon'), '"dragon"')
  assertEquals(term('a burglar and a dragon'), '"a burglar and a dragon"')
})

Deno.test('match syntax a person typed is text, not grammar', () => {
  assertEquals(term('dragon OR NEAR(x)'), '"dragon OR NEAR(x)"')
  assertEquals(term('say "hi"'), '"say hi"')
  assertEquals(term('col:value'), '"col:value"')
})

Deno.test('a trailing star is the one piece of grammar a person can reach', () => {
  assertEquals(term('drag*'), '"drag"*')
  assertEquals(term('drag**'), '"drag"*')
  assertEquals(term('a drag*'), '"a drag"*')
})

Deno.test('text with no word in it is no term at all', () => {
  assertEquals(term(''), '')
  assertEquals(term('   '), '')
  assertEquals(term('*'), '')
  assertEquals(term('""'), '')
})
