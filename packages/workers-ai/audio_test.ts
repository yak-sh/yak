// Paid inference is replaced by the binding; output bytes cross the same door.
import { test } from '@yaks/testing'
import { assertAlmostEquals, assertEquals, assertRejects } from '@std/assert'
import { artifactStore, memoryBlobs } from '@yaks/blob'
import { ModelError } from '@yaks/model'
import { audioPrice, audioSeconds, music, workersAi } from './mod.ts'

let mp3 = () => {
  let frame = new Uint8Array(576)
  frame.set([255, 251, 180, 0]) // MPEG1, 192kbps, 48kHz, 1152 samples
  let bytes = new Uint8Array(frame.length * 1250)
  for (let p = 0; p < bytes.length; p += frame.length) bytes.set(frame, p)
  return bytes
}

let ask = (model: string) => ({
  model,
  tools: [],
  instructions: 'Use oud and flute.',
  items: [{ kind: 'user' as const, text: 'A quiet desert welcome.' }],
})

for (let name of ['elevenlabs/music-v2', 'minimax/music-2.6']) {
  test(`${name} sends music input and stores audio at its tariff`, async () => {
    let input: unknown, sent: string | undefined, downloads = 0
    let blobs = memoryBlobs()
    let model = workersAi({
      run: (name, body) => {
        input = body
        sent = name
        return Promise.resolve({
          state: 'Completed',
          result: { audio: 'https://audio.example/song.mp3' },
        })
      },
    }, {
      media: { store: artifactStore(blobs) },
      fetch: (url, init) => {
        assertEquals(String(url), 'https://audio.example/song.mp3')
        assertEquals(init?.redirect, 'error')
        assertEquals(init?.headers, undefined)
        downloads++
        return Promise.resolve(new Response(mp3()))
      },
    })
    let reply = await model(ask(name))
    assertEquals(sent, name)
    assertEquals(
      input,
      name == 'elevenlabs/music-v2'
        ? {
          prompt: 'Use oud and flute.\n\nA quiet desert welcome.',
          music_length_ms: 30000,
          output_format: 'mp3_48000_192',
        }
        : {
          prompt: 'Use oud and flute.\n\nA quiet desert welcome.',
          lyrics_optimizer: false,
          is_instrumental: true,
          format: 'mp3',
        },
    )
    assertEquals(downloads, 1)
    assertEquals(reply.items, [])
    assertAlmostEquals(
      reply.cost!,
      name == 'elevenlabs/music-v2' ? 0.075 : 0.15,
    )
    let [artifact] = reply.artifacts!
    assertEquals(artifact.media_type, 'audio/mpeg')
    assertEquals(artifact.size, mp3().length)
    assertEquals(artifact.call, reply.id + ':audio')
    assertEquals(await blobs.get(artifact.address), mp3())
  })
}

test('duration and request tariffs do not use JSON token estimates', () => {
  assertAlmostEquals(audioSeconds(mp3()), 30)
  assertAlmostEquals(audioPrice('elevenlabs/music-v2', {}, 30), 0.075)
  assertEquals(
    audioPrice('minimax/music-2.6', { lyrics_optimizer: true }, 0),
    0.16,
  )
  assertEquals(music('@cf/zai-org/glm-5.3-flash'), false)
})

test('music needs storage before asking; invalid output is never persisted', async () => {
  let calls = 0, stores = 0
  let binding = {
    run: () => {
      calls++
      return Promise.resolve({ audio: 'https://audio.example/song.mp3' })
    },
  }
  await assertRejects(
    () => workersAi(binding)(ask('elevenlabs/music-v2')),
    ModelError,
  )
  assertEquals(calls, 0)
  for (let bytes of [new Uint8Array([1]), mp3().subarray(0, 600)]) {
    let model = workersAi(binding, {
      media: {
        store: () => {
          stores++
          throw new Error('not reached')
        },
      },
      fetch: () => Promise.resolve(new Response(bytes)),
    })
    await assertRejects(() => model(ask('elevenlabs/music-v2')), ModelError)
  }
  assertEquals(stores, 0)
})
