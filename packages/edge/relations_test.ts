// Which components are relations, read off the vocabulary.

import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { edgeKeywords } from './keywords.ts'
import { names, relations } from './relations.ts'
import { blog } from './harness.ts'

Deno.test('a relation is whatever the vocabulary says is one', () => {
  assertEquals(relations(blog), { cites: 'cites', linked: 'links' })
  assertEquals(names(blog), { cites: 'cites', links: 'linked' })
})

Deno.test('an ordinary component is not a relation', () => {
  assertEquals(relations(blog).pinned, undefined)
  assertEquals(names(blog).post, undefined)
})

Deno.test('an unregistered keyword is invisible, so nothing is a relation', () => {
  // The loader carries only the keywords it was given: without edgeKeywords the
  // declaration is dropped, and this package sees a vocabulary with no
  // relations rather than guessing at one.
  let v = loadVocab([{ $defs: { cites: { type: 'object', relation: true } } }])
  assertEquals(relations(v), {})
})

Deno.test('the open set is as long as an application makes it', () => {
  let v = loadVocab([{
    $defs: {
      cites: { type: 'object', relation: true },
      answers: { type: 'object', relation: true },
      translates: { type: 'object', relation: 'translated' },
    },
  }], [edgeKeywords])
  assertEquals(Object.keys(relations(v)).sort(), [
    'answers',
    'cites',
    'translated',
  ])
})
