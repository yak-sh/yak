// What a person types, spelled safely for FTS5.

import { assertEquals } from '@std/assert'
import { match, term } from './term.ts'

Deno.test('a word is quoted, so every character in it is literal', () => {
  assertEquals(term('dragon'), '"dragon"*')
  assertEquals(term('col:value'), '"col:value"*')
  assertEquals(term('say "hi"'), '"say hi"')
})

Deno.test('a word prefix-matches; a run of words is the phrase it reads as', () => {
  assertEquals(term('research'), '"research"*')
  assertEquals(term('a burglar and a dragon'), '"a burglar and a dragon"')
})

Deno.test('match syntax a person typed is text, not grammar', () => {
  assertEquals(term('dragon OR NEAR(x)'), '"dragon OR NEAR(x)"')
  assertEquals(match('dragon OR NEAR(x)'), '"dragon"* "OR"* "NEAR(x)"*')
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
  assertEquals(match(''), '')
  assertEquals(match('  ""  '), '')
})

Deno.test('a search string is its words, ANDed', () => {
  assertEquals(match('entropy purge'), '"entropy"* "purge"*')
  assertEquals(match('  entropy   purge  '), '"entropy"* "purge"*')
})

Deno.test('a quoted run stays one phrase, beside the loose words', () => {
  assertEquals(match('"entropy purge"'), '"entropy purge"')
  assertEquals(
    match('the "entropy purge" memo'),
    '"the"* "entropy purge" "memo"*',
  )
  // Half a phrase is still a phrase — somebody is mid-sentence.
  assertEquals(match('"entropy purge'), '"entropy purge"')
})
