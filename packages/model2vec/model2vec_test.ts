// A static model read the way Model2Vec reads it, and a model on the hub
// fetched once and kept.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { load, model2vec, space, table } from './mod.ts'
import { files, raw, safetensors } from './testing.ts'

let near = (v: Float32Array, want: number[]) =>
  assertEquals([...v].map((x) => +x.toFixed(4)), want)
let h = +Math.SQRT1_2.toFixed(4)
let e = await load('tiny', files)

test('a text is the mean of its known tokens, at length 1', () => {
  near(e.embed('Red DRAGON'), [h, h, 0, 0])
  // an unknown word is dropped, never read as the [UNK] row
  near(e.embed('red zebra'), [1, 0, 0, 0])
  // nothing known, nothing said: the zero vector, unrelated to everything
  near(e.embed('zebra'), [0, 0, 0, 0])
})

test('only the first `max` tokens are read', async () => {
  let one = await load('tiny', files, { max: 1 })
  near(one.embed('red dragon'), [1, 0, 0, 0])
})

test('a narrower table is the model at a smaller width', async () => {
  let two = await load('tiny#2', files, { dim: 2 })
  near(two.embed('red dragon'), [h, h])
  near(two.embed('blue whale'), [0, 0])
  assertEquals(space({ model: 'o/m@abc', dim: 2 }), 'o/m@abc#2')
  assertEquals(space({ model: 'o/m@abc' }), 'o/m@abc')
})

test('a table in a layout this does not read is refused', () => {
  let t = { dtype: 'F32', shape: [1, 1], data_offsets: [0, 4] }
  let one = new Float32Array([1])
  assertThrows(
    () => table(raw({ embeddings: t, weights: t }, one)),
    Error,
    'weights',
  )
  assertThrows(
    () => table(raw({ embeddings: { ...t, dtype: 'F16' } }, one)),
    Error,
    'F16',
  )
  assertThrows(() => table(safetensors([[1, 2]]), 3), Error, 'narrower')
})

// A hub that serves the tiny model's files and counts what it was asked for.
let hub = (fail = 0) => {
  let asked: string[] = []
  let root = `https://hub.test/${crypto.randomUUID()}`
  let go = (url: string | URL | Request) => {
    asked.push(String(url))
    if (fail-- > 0) {
      return Promise.resolve(new Response('down', { status: 503 }))
    }
    let name = String(url).split('/').at(-1)
    let body = name == 'tokenizer.json' ? files.tokenizer : files.safetensors
    return Promise.resolve(new Response(body))
  }
  let forget = async () => {
    let shelf = await caches.open('@yaks/model2vec')
    for (let url of asked) await shelf.delete(url)
  }
  return { asked, root, go: go as typeof fetch, forget }
}

test('a hub model is fetched on the first embed, then kept', async () => {
  let { asked, root, go, forget } = hub()
  try {
    let said = { model: 'o/tiny@abc', hub: root, fetch: go }
    let m = model2vec(said)
    assertEquals(m.model, 'o/tiny@abc')
    assertEquals(asked, [])
    near(await m.embed('red dragon'), [h, h, 0, 0])
    assertEquals(asked.toSorted(), [
      `${root}/o/tiny/resolve/abc/model.safetensors`,
      `${root}/o/tiny/resolve/abc/tokenizer.json`,
    ])
    // loaded, it answers at once, and so does the same model named again
    assert(m.embed('red') instanceof Float32Array)
    assert(model2vec(said).embed('red') instanceof Float32Array)
    // another reading of the same files finds them where the first kept them
    near(await model2vec({ ...said, max: 1 }).embed('red dragon'), [1, 0, 0, 0])
    assertEquals(asked.length, 2)
  } finally {
    await forget()
  }
})

test('a load that fails is tried again on the next embed', async () => {
  let { root, go, forget } = hub(1)
  try {
    let m = model2vec({ model: 'o/tiny@abc', hub: root, fetch: go })
    await assertRejects(async () => await m.embed('red'), Error, '503')
    near(await m.embed('red'), [1, 0, 0, 0])
  } finally {
    await forget()
  }
})
