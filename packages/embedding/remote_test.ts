// The HTTP embedder: two servers, one sentence — and what a fault does.

import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { cut, type Fetch, remote } from './remote.ts'

// Float32 stores what it can: compare a vector at the precision it has.
let round = (v: Float32Array) => [...v].map((n) => Math.round(n * 1e6) / 1e6)

let answered = (body: unknown, ok = true, status = 200) => {
  let seen: { url: string; init: Parameters<Fetch>[1] }[] = []
  let go: Fetch = (url, init) => {
    seen.push({ url, init })
    return Promise.resolve({
      ok,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  }
  return { go, seen }
}

Deno.test('ollama: /api/embed, and the vector out of `embeddings`', async () => {
  let { go, seen } = answered({ embeddings: [[3, 4]] })
  let e = remote({
    via: 'ollama',
    model: 'qwen3',
    base: 'https://box/',
    fetch: go,
  })
  assertEquals(e.model, 'qwen3')
  assertEquals([...await e.embed('hello')], [3, 4])
  assertEquals(seen[0].url, 'https://box/api/embed')
  assertEquals(seen[0].init?.body, '{"model":"qwen3","input":"hello"}')
  assert(!seen[0].init?.headers?.authorization)
})

Deno.test('a text longer than the model reads is sent as its opening', async () => {
  let { go, seen } = answered({ embeddings: [[1]] })
  let e = remote({ via: 'ollama', model: 'm', base: 'b', chars: 3, fetch: go })
  await e.embed('abcdef')
  assertEquals(JSON.parse(seen[0].init!.body!).input, 'abc')
})

Deno.test('openai: /v1/embeddings, the vector out of `data`, and the key as a bearer', async () => {
  let { go, seen } = answered({ data: [{ embedding: [1, 0] }] })
  let e = remote({
    via: 'openai',
    model: 'text-embedding-3-small',
    base: 'https://api.example',
    key: 'sk-x',
    fetch: go,
  })
  assertEquals([...await e.embed('hi')], [1, 0])
  assertEquals(seen[0].url, 'https://api.example/v1/embeddings')
  assertEquals(seen[0].init?.headers?.authorization, 'Bearer sk-x')
})

Deno.test('a dim keeps the leading coordinates, renormalized', async () => {
  let { go } = answered({ embeddings: [[3, 4, 99]] })
  let e = remote({
    via: 'ollama',
    model: 'm',
    base: 'https://box',
    dim: 2,
    fetch: go,
  })
  assertEquals(round(await e.embed('x')), [0.6, 0.8])
})

Deno.test('a model narrower than the dim asked for is a refusal, not a pad', () => {
  assertEquals(round(cut(Float32Array.from([3, 4, 0]), 2)), [0.6, 0.8])
  assertThrows(() => cut(Float32Array.from([1]), 2), Error, 'fewer than the 2')
})

Deno.test('a status and a shapeless answer both throw, with the body in the words', async () => {
  let bad = answered({ error: 'no such model' }, false, 404)
  let e = remote({
    via: 'ollama',
    model: 'gone',
    base: 'https://box',
    fetch: bad.go,
  })
  await assertRejects(async () => await e.embed('x'), Error, '404')
  let empty = answered({ embeddings: [] })
  let f = remote({
    via: 'ollama',
    model: 'm',
    base: 'https://box',
    fetch: empty.go,
  })
  await assertRejects(async () => await f.embed('x'), Error, 'no vector')
})
