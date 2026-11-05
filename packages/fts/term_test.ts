// What a person types, spelled safely for FTS5.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { excerpt, keywords, match, named, term } from './term.ts'

test('a word is quoted, so every character in it is literal', () => {
  assertEquals(term('dragon'), '"dragon"*')
  assertEquals(term('col:value'), '"col:value"*')
  assertEquals(term('say "hi"'), '"say hi"')
})

test('a word prefix-matches; a run of words is the phrase it reads as', () => {
  assertEquals(term('research'), '"research"*')
  assertEquals(term('a burglar and a dragon'), '"a burglar and a dragon"')
})

test('match syntax a person typed is text, not grammar', () => {
  assertEquals(term('dragon OR NEAR(x)'), '"dragon OR NEAR(x)"')
  assertEquals(match('dragon OR NEAR(x)'), '"dragon"* "OR" "NEAR(x)"')
})

test('a word ending in a short token matches exactly unless starred', () => {
  assertEquals(term('a'), '"a"')
  assertEquals(term('a*'), '"a"*')
  assertEquals(term('ui'), '"ui"')
  assertEquals(term("step's"), '"step\'s"')
  assertEquals(term('yak.sh'), '"yak.sh"')
  assertEquals(term('yak.dev'), '"yak.dev"*')
  assertEquals(match('a dragon'), '"a" "dragon"*')
})

test('a common word is whole as typed, so a long question stays narrow', () => {
  assertEquals(term('Each'), '"Each"')
  assertEquals(term('each*'), '"each"*')
  assertEquals(
    match("yak.sh each step's drawing plays out over a screen of scrolling"),
    '"yak.sh" "each" "step\'s" "drawing"* "plays"* "out" "over"* "a" ' +
      '"screen"* "of" "scrolling"*',
  )
})

test('a trailing star is the one piece of grammar a person can reach', () => {
  assertEquals(term('drag*'), '"drag"*')
  assertEquals(term('drag**'), '"drag"*')
  assertEquals(term('a drag*'), '"a drag"*')
})

test('text with no word in it is no term at all', () => {
  assertEquals(term(''), '')
  assertEquals(term('   '), '')
  assertEquals(term('*'), '')
  assertEquals(term('""'), '')
  assertEquals(match(''), '')
  assertEquals(match('  ""  '), '')
})

test('a search string is its words, ANDed', () => {
  assertEquals(match('entropy purge'), '"entropy"* "purge"*')
  assertEquals(match('  entropy   purge  '), '"entropy"* "purge"*')
})

test('a quoted run stays one phrase, beside the loose words', () => {
  assertEquals(match('"entropy purge"'), '"entropy purge"')
  assertEquals(
    match('the "entropy purge" memo'),
    '"the" "entropy purge" "memo"*',
  )
  // Half a phrase is still a phrase — somebody is mid-sentence.
  assertEquals(match('"entropy purge'), '"entropy purge"')
})

test('the words a name is written in drop their grammar', () => {
  assertEquals(named('  Mossvale  '), 'Mossvale')
  assertEquals(named('"the hobbit" drag*'), 'the hobbit drag')
  assertEquals(named(' "" * '), '')
})

test('excerpt retains useful terms without discarding search words', () => {
  assertEquals(
    match('a burglar with a dragon'),
    '"a" "burglar"* "with" "a" "dragon"*',
  )
  assertEquals(excerpt('a burglar with a dragon'), '"burglar"* "dragon"*')
  assertEquals(excerpt('a with'), term('a'))
  assertEquals(excerpt('the "a dragon" with wings'), '"a dragon" "wings"*')
  assertEquals(excerpt('with* wings'), '"with"* "wings"*')
})

test('a question keeps its distinctive words and its quoted phrases', () => {
  assertEquals(keywords('When is the next board meeting?'), [
    'next',
    'board',
    'meeting?',
  ])
  assertEquals(keywords('"the board" seconded'), ['"the board"', 'seconded'])
})
