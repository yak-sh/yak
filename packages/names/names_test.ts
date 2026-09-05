// Names over a small bookstore vocabulary: an author and a shelf answer to a
// name, a review does not — its title is a sentence, not a handle.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { extendMeta, loadVocab, type VocabDoc } from '@yaks/vocab'
import { nameKeywords, NAMES_URI } from './keywords.ts'
import { named, nameOf, resolve } from './names.ts'

let catalog: VocabDoc = {
  $vocabulary: { 'https://yaks.sh/vocab/core': true, [NAMES_URI]: true },
  $defs: {
    doc: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    author: { type: 'object', kind: true, by_name: true },
    review: {
      type: 'object',
      kind: true,
      properties: { stars: { type: 'number' } },
    },
    shelf: {
      type: 'object',
      kind: true,
      by_name: 'label',
      properties: { label: { type: 'string' } },
    },
  },
}

let v = loadVocab([catalog], [nameKeywords])
let name = nameOf(v)
let byName = resolve(v)

let leguin = { comps: { author: {}, doc: { title: 'Ursula Le Guin' } } }
let review = { comps: { review: {}, doc: { title: 'Ursula at her best' } } }
let fiction = { comps: { shelf: { label: 'Fiction' } } }
let shelf = [leguin, review, fiction]

Deno.test('the vocabulary says which components answer to a name', () => {
  assertEquals(named(v), {
    author: { comp: 'doc', prop: 'title' }, // the default name column
    shelf: { comp: 'shelf', prop: 'label' }, // its own, by declaration
  })
})

Deno.test('a name is read only off an entity that has one', () => {
  assertEquals(name(leguin), 'Ursula Le Guin')
  assertEquals(name(fiction), 'Fiction')
  assertEquals(name(review), undefined) // a title, but not a name
  assertEquals(name({ comps: { author: {} } }), undefined) // named, unnamed
})

Deno.test('an exact name resolves, whatever the case or punctuation', () => {
  for (let typed of ['Ursula Le Guin', 'ursula le guin', 'ursula-le-guin']) {
    assertEquals(byName(typed, shelf), leguin, typed)
  }
  assertEquals(byName('fiction', shelf), fiction)
})

Deno.test('a name typed the way people type it still lands', () => {
  assertEquals(byName('ursula', shelf), leguin) // the first word
  assertEquals(byName('le guin', shelf), leguin) // most of the name
  assertEquals(byName('leguin', shelf), leguin) // …spelled together
  assertEquals(byName('fictoin', shelf), fiction) // a typo
})

Deno.test('a word that names nothing resolves to nothing', () => {
  assertEquals(byName('dickens', shelf), undefined)
  assertEquals(byName('', shelf), undefined)
  // prose is never reached, not even by its own opening word
  assertEquals(byName('best', shelf), undefined)
})

Deno.test('exact-only resolution is one option away', () => {
  let exact = resolve(v, { close: 1 })
  assertEquals(exact('Ursula Le Guin', shelf), leguin)
  assertEquals(exact('ursula', shelf), undefined)
})

Deno.test('the name column is the vocabulary’s, and a missing one refuses', () => {
  let byLabel = nameOf(v, { prop: 'body' })
  assertEquals(byLabel(leguin), undefined) // the author's doc has no body
  assertThrows(() => named(v, { prop: 'nonsense' }), Error, 'unknown prop')
})

Deno.test('the keyword is registered, so the loader carries it', () => {
  assertEquals(v.comp('author')?.keywords, { by_name: true })
  assertEquals(v.comp('review')?.keywords, {})
  // without the registration the vocabulary answers nothing about names
  assertEquals(named(loadVocab([catalog])), {})
  // and the meta-schema admits `by_name` only once composed
  let meta = extendMeta([nameKeywords]) as Record<
    string,
    Record<string, unknown>
  >
  let comp = meta.$defs.component as { properties: Record<string, unknown> }
  assert(comp.properties.by_name)
  assertEquals(meta.$vocabulary[NAMES_URI], true)
})
