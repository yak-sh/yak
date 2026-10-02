// Delivery failure retains the same recording privately; fixtures never call AI.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { provisionalDoc } from '@yaks/effects'
import { toolsDoc } from '@yaks/tools/vocab'
import { ramVault, records, secrets, secretsDoc } from '@yaks/secrets'
import { type MediaReceipt, mediaReceipts, ModelError } from '@yaks/model'
import { artifactStore, memoryBlobs } from '@yaks/blob'
import { workersAi } from './mod.ts'

let setup = () => {
  let vault = ramVault()
  let vocab = loadVocab([secretsDoc, provisionalDoc, toolsDoc])
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [secrets(vault, (b) => g.apply(b, { trusted: true }))],
  })
  let store = () =>
    mediaReceipts(records<Partial<MediaReceipt>>(
      g,
      vault,
      'generated-media:fixture:',
    ))
  return { g, vault, store }
}
let mp3 = () => {
  let bytes = new Uint8Array(576)
  bytes.set([255, 251, 180, 0])
  return bytes
}
let req = {
  call: 'original-ask',
  model: 'elevenlabs/music-v2',
  items: [{ kind: 'user' as const, text: 'Fixture music' }],
  tools: [],
}
let signed = 'https://audio.example/fixture.mp3?token=fixture-private'

test('private receipt precedes failed delivery and reopened recovery never generates', async () => {
  let { g, store } = setup()
  let generations = 0, downloads = 0, checkpoints = 0
  let blobs = memoryBlobs()
  let binding = {
    run: () => {
      generations++
      return Promise.resolve({
        state: 'Completed',
        result: {
          id: 'provider-original',
          audio: signed,
        },
        gatewayMetadata: { cost: 0.45 },
      })
    },
  }
  let model = workersAi(binding, {
    receipts: store(),
    media: { store: artifactStore(blobs) },
    fetch: async () => {
      downloads++
      assertEquals((await store().read(req.call))?.cost, 0.45)
      throw new Error('Fetch refused ' + signed)
    },
  })
  let error = await assertRejects(
    () =>
      model({
        ...req,
        onMedia: (receipt) => {
          checkpoints++
          assertEquals(receipt.id, 'provider-original')
          assertEquals(receipt.cost, 0.45)
          return Promise.resolve()
        },
      }),
    ModelError,
  )
  assertEquals(error.message.includes('fixture-private'), false)
  assertEquals(error.stack?.includes('fixture-private'), false)
  assertEquals(
    JSON.stringify(await g.read('.secret&*')).includes('fixture-private'),
    false,
  )
  assertEquals([generations, downloads, checkpoints], [1, 1, 1])
  let reopened = workersAi({
    run: () => {
      throw new Error('No generation')
    },
  }, {
    receipts: store(),
    media: { store: artifactStore(blobs) },
    fetch: () => {
      downloads++
      return Promise.resolve(new Response(mp3()))
    },
  })
  await assertRejects(() => reopened(req), ModelError, 'use recovery instead')
  let reply = await reopened.recover!(req.call)
  assertEquals([reply.id, reply.cost, reply.costReported], [
    'provider-original',
    0.45,
    true,
  ])
  assertEquals(reply.artifacts?.[0].call, 'provider-original:audio')
  assertEquals(await reopened.recover!(req.call), reply)
  assertEquals([generations, downloads], [1, 2])
})

test('failed private persistence refuses download and storage errors hide credentials', async () => {
  let { store } = setup()
  let downloads = 0
  let binding = { run: () => Promise.resolve({ id: 'p', audio: signed }) }
  let bad = workersAi(binding, {
    receipts: {
      read: () => Promise.resolve(undefined),
      save: () => Promise.reject(new Error('vault offline')),
    },
    media: { store: artifactStore(memoryBlobs()) },
    fetch: () => {
      downloads++
      return Promise.resolve(new Response(mp3()))
    },
  })
  await assertRejects(() => bad(req), Error, 'vault offline')
  assertEquals(downloads, 0)
  let model = workersAi(binding, {
    receipts: store(),
    media: {
      store: () => Promise.reject(new Error(signed)),
    },
    fetch: () => Promise.resolve(new Response(mp3())),
  })
  let error = await assertRejects(() => model(req), ModelError)
  assertEquals(error.message.includes('fixture-private'), false)
  let recovered = workersAi(binding, {
    receipts: store(),
    media: {
      store: artifactStore(memoryBlobs()),
    },
    fetch: () => Promise.resolve(new Response(mp3())),
  })
  assertEquals((await recovered.recover!(req.call)).id, 'p')
})
