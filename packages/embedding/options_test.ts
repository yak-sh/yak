// What a config says to this plugin: the embedder it names, and the text it
// chose.

import { assertEquals, assertThrows } from '@std/assert'
import { chosen, embedderOf } from './options.ts'
import { shop } from './harness.ts'

Deno.test('the offline embedder is named like any other', () => {
  assertEquals(embedderOf({ embedder: { via: 'hash' } }).model, 'hash-64')
  assertEquals(
    embedderOf({ embedder: { via: 'hash', dim: 8 } }).model,
    'hash-8',
  )
})

Deno.test('a hosted one carries its model name into the vector space', () => {
  let e = embedderOf({
    embedder: { via: 'ollama', model: 'qwen3', base: 'https://box' },
  })
  assertEquals(e.model, 'qwen3')
})

Deno.test('a plugin with no embedder refuses at boot, not at every search', () => {
  assertThrows(() => embedderOf({}), Error, 'name an `embedder`')
  assertThrows(
    () => embedderOf({ embedder: { via: 'magic' } as never }),
    Error,
    '"magic"',
  )
})

Deno.test('text defaults to every textual column and narrows by name', () => {
  assertEquals(chosen(shop, {}).map((f) => `${f.comp}.${f.prop}`), [
    'book.title',
    'book.blurb',
    'review.prose',
  ])
  assertEquals(chosen(shop, { text: ['book.blurb'] }), [{
    comp: 'book',
    prop: 'blurb',
  }])
})

Deno.test('a column nothing declares is a refusal, not a field that embeds nothing', () => {
  assertThrows(
    () => chosen(shop, { text: ['book.spine'] }),
    Error,
    'book.spine',
  )
  assertThrows(() => chosen(shop, { text: ['book'] }), Error, '"book"')
})
