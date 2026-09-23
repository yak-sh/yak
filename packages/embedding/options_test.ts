// What a config says to this plugin: the embedder it names, and the text it
// chose.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { chosen, embedderOf, ready } from './options.ts'
import { shop } from './harness.ts'

Deno.test('the offline embedder is named like any other', () => {
  assertEquals(
    embedderOf({ embedder: { via: 'hash' } }).embedder?.model,
    'hash-64',
  )
  assertEquals(
    embedderOf({ embedder: { via: 'hash', dim: 8 } }).embedder?.model,
    'hash-8',
  )
})

Deno.test('a hosted one carries its model name into the vector space', () => {
  let said = embedderOf({
    embedder: { via: 'ollama', model: 'qwen3', base: 'https://box' },
  })
  assertEquals(said.embedder?.model, 'qwen3')
  assertEquals(said.model, 'qwen3')
})

Deno.test('config that has not arrived is waiting, never a boot failure', () => {
  let none = embedderOf({})
  assertEquals(none.embedder, undefined)
  assert(none.waiting?.includes('no `embedder` is named'), `${none.waiting}`)
  // A name nothing implements will never become one: still a refusal, said
  // here rather than thrown at the host.
  let magic = embedderOf({ embedder: { via: 'magic' } as never })
  assertEquals(magic.embedder, undefined)
  assert(magic.waiting?.includes('"magic"'), `${magic.waiting}`)
})

Deno.test('a key the environment has not got yet is waiting, and the space is known anyway', () => {
  let asked = {
    via: 'ollama',
    model: 'qwen3',
    base: 'https://box',
    key: undefined,
  } as const
  let said = embedderOf({ embedder: asked })
  assertEquals(said.embedder, undefined)
  assert(said.waiting?.startsWith('waiting for a key'), `${said.waiting}`)
  // the model still names the space, so `.near` ranks over what is stored
  assertEquals(said.model, 'qwen3')
  // and the moment the key is there, the same options answer with an embedder
  assertEquals(
    embedderOf({ embedder: { ...asked, key: 'hunter2' } }).embedder?.model,
    'qwen3',
  )
  // a config that never named a key never wanted one
  let open = embedderOf({
    embedder: { via: 'ollama', model: 'qwen3', base: 'https://box' },
  })
  assertEquals(open.waiting, undefined)
})

Deno.test('what a pass needs is read whole, and a bad name waits rather than throws', () => {
  let now = ready(shop, { embedder: { via: 'hash' } })
  assertEquals(now.text.length, 3)
  assertEquals(now.embedder?.model, 'hash-64')
  let bad = ready(shop, { embedder: { via: 'hash' }, text: ['book.spine'] })
  assertEquals(bad.text, [])
  assertEquals(bad.embedder, undefined)
  assert(bad.waiting?.includes('book.spine'), `${bad.waiting}`)
})

Deno.test('text defaults to every textual property and narrows by name', () => {
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

Deno.test('a property nothing declares is a refusal, not a field that embeds nothing', () => {
  assertThrows(
    () => chosen(shop, { text: ['book.spine'] }),
    Error,
    'book.spine',
  )
  assertThrows(() => chosen(shop, { text: ['book'] }), Error, '"book"')
})
