// The shipped embedder: same answer every time, shared words score high, and
// the hash names the model as well as the text.

import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { hash, hashEmbedder } from './embedder.ts'
import { cosine } from './vector.ts'

let e = hashEmbedder()
let vec = (t: string) => e.embed(t) as Float32Array

Deno.test('the same text always embeds to the same vector', () => {
  assertEquals([...vec('a burglar and a dragon')], [...vec(
    'a burglar and a dragon',
  )])
})

Deno.test('shared words are near, unshared words are not', () => {
  let dragon = vec('a burglar leaves home and meets a dragon')
  let flight = vec('a dragon meets a burglar who leaves home')
  let cook = vec('a cook writes what the nights are like')
  assert(cosine(dragon, flight) > 0.85, `${cosine(dragon, flight)}`)
  assert(cosine(dragon, cook) < 0.4, `${cosine(dragon, cook)}`)
})

Deno.test('a vector comes back at length 1 and in the named space', () => {
  let u = vec('dragons')
  assertEquals(u.length, 64)
  assert(Math.abs(Math.hypot(...u) - 1) < 1e-6)
  assertEquals(e.model, 'hash-64')
  assertEquals(hashEmbedder(32).model, 'hash-32')
})

Deno.test('text with no words embeds to nothing at all', () => {
  assertEquals([...vec('  ...  ')].filter((x) => x != 0), [])
})

Deno.test('the hash names the model too, so a model change invalidates', () => {
  assertEquals(hash('hash-64', 'dragons'), hash('hash-64', 'dragons'))
  assertNotEquals(hash('hash-64', 'dragons'), hash('hash-32', 'dragons'))
  assertNotEquals(hash('hash-64', 'dragons'), hash('hash-64', 'cooks'))
})
