// What a config says to this plugin: the embedder it names, as a provider and
// a model, and the text it chose.

import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from '@std/assert'
import { chosen, embedderOf, type Named, ready, spaceOf } from './options.ts'
import type { Fetch } from './remote.ts'
import { none, serving, shop } from './testing.ts'

let OLLAMA = { name: 'gpu', api: 'ollama', base: 'https://box/' }

// A server that answers every input with the same vector, and keeps what it
// was asked.
let server = () => {
  let seen: { url: string; body: { model: string; input: string[] } }[] = []
  let fetch: Fetch = (url, init) => {
    let body = JSON.parse(init!.body!)
    seen.push({ url, body })
    let embeddings = body.input.map(() => [3, 4])
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ embeddings })),
    })
  }
  return { fetch, seen }
}

test('the offline embedder is named like any other', async () => {
  let named = async (embedder: Named) =>
    (await embedderOf({ embedder }, none)).embedder?.model
  assertEquals(await named({ provider: 'hash' }), 'hash-64')
  assertEquals(await named({ provider: 'hash', dim: 8 }), 'hash-8')
})

test('a provider row serves the model under its own name, and the space is the model', async () => {
  let g = await serving(OLLAMA, 'arctic-s', 'snowflake-arctic-embed:33m')
  let { fetch, seen } = server()
  let said = await embedderOf(
    { embedder: { provider: 'gpu', model: 'arctic-s', fetch } },
    g,
  )
  assertEquals(said.model, 'arctic-s')
  assertEquals(said.embedder?.model, 'arctic-s')
  await said.embedder!.embed('hello')
  assertEquals(seen[0].url, 'https://box/api/embed')
  assertEquals(seen[0].body.model, 'snowflake-arctic-embed:33m')
})

test('the same model from another provider is the same space', async () => {
  let there = { name: 'hosted', api: 'openai', base: 'https://api.example' }
  let here = await embedderOf(
    { embedder: { provider: 'gpu', model: 'arctic-s', dim: 256 } },
    await serving(OLLAMA, 'arctic-s', 'snowflake-arctic-embed:33m'),
  )
  let away = await embedderOf(
    { embedder: { provider: 'hosted', model: 'arctic-s', dim: 256 } },
    await serving(there, 'arctic-s', 'Snowflake/arctic-embed-s'),
  )
  assertEquals(here.embedder?.model, 'arctic-s#256')
  assertEquals(away.embedder?.model, here.embedder?.model)
})

test('two widths of one model are two spaces', () => {
  let qwen = { provider: 'gpu', model: 'qwen3' }
  assertNotEquals(
    spaceOf({ ...qwen, dim: 256 }),
    spaceOf({ ...qwen, dim: 384 }),
  )
  let potion = { provider: 'model2vec', model: 'o/potion@abc' }
  assertNotEquals(spaceOf({ ...potion, dim: 256 }), spaceOf(potion))
})

test('what is missing is waiting, never a boot failure, and the space is known anyway', async () => {
  let waits = async (embedder: Named | undefined, rows = none) => {
    let said = await embedderOf({ embedder }, rows)
    assertEquals(said.embedder, undefined)
    return said
  }
  assert((await waits(undefined)).waiting?.includes('no `embedder` is named'))
  let gone = await waits({ provider: 'gpu', model: 'qwen3' })
  assert(gone.waiting?.includes('no provider called "gpu"'), gone.waiting)
  // the model still names the space, so `.near` ranks over what is stored
  assertEquals(gone.model, 'qwen3')
  let g = await serving(OLLAMA, 'arctic-s')
  let other = await waits({ provider: 'gpu', model: 'qwen3' }, g)
  assert(other.waiting?.includes('serves no model called "qwen3"'))
  let mute = await waits(
    { provider: 'gpu', model: 'arctic-s' },
    await serving({ name: 'gpu', base: 'https://box' }, 'arctic-s'),
  )
  assert(mute.waiting?.includes('provider.api'), mute.waiting)
  let lost = await waits(
    { provider: 'gpu', model: 'arctic-s' },
    await serving({ name: 'gpu', api: 'ollama' }, 'arctic-s'),
  )
  assert(lost.waiting?.includes('provider.base'), lost.waiting)
})

test('a key the environment has not got yet is waiting, until it has', async () => {
  let g = await serving(OLLAMA, 'qwen3')
  let asked: Named = { provider: 'gpu', model: 'qwen3', key: undefined }
  let said = await embedderOf({ embedder: asked }, g)
  assert(said.waiting?.startsWith('waiting for a key'), said.waiting)
  assertEquals(said.model, 'qwen3')
  let keyed = await embedderOf({ embedder: { ...asked, key: 'hunter2' } }, g)
  assertEquals(keyed.embedder?.model, 'qwen3')
  // a config that never named a key never wanted one
  let open = await embedderOf(
    { embedder: { provider: 'gpu', model: 'qwen3' } },
    g,
  )
  assertEquals(open.waiting, undefined)
})

test('what a pass needs is read whole, and a bad name waits rather than throws', async () => {
  let now = await ready(shop, { embedder: { provider: 'hash' } }, none)
  assertEquals(now.text.length, 2)
  assertEquals(now.embedder?.model, 'hash-64')
  let bad = await ready(
    shop,
    { embedder: { provider: 'hash' }, text: ['book.spine'] },
    none,
  )
  assertEquals(bad.text, [])
  assertEquals(bad.embedder, undefined)
  assert(bad.waiting?.includes('book.spine'), `${bad.waiting}`)
})

test('text defaults to the searched properties and narrows by name', () => {
  assertEquals(chosen(shop, {}).map((f) => `${f.comp}.${f.prop}`), [
    'book.title',
    'review.prose',
  ])
  assertEquals(chosen(shop, { text: ['book.blurb'] }), [{
    comp: 'book',
    prop: 'blurb',
  }])
})

test('a property nothing declares is a refusal, not a field that embeds nothing', () => {
  assertThrows(
    () => chosen(shop, { text: ['book.spine'] }),
    Error,
    'book.spine',
  )
  assertThrows(() => chosen(shop, { text: ['book'] }), Error, '"book"')
})
