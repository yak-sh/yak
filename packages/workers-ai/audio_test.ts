// Paid inference is replaced by the binding; output bytes cross the same door.
import { test } from '@yaks/testing'
import { assertAlmostEquals, assertEquals, assertRejects } from '@std/assert'
import { artifactStore, memoryBlobs } from '@yaks/blob'
import { ModelError } from '@yaks/model'
import { audioPrice, audioSeconds, music, workersAi } from './mod.ts'
import { musicInput } from './audio.ts'

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
  ...model == 'minimax/music-2.6'
    ? { input: { lyrics: '[Chorus]\nOoh\nAh' } }
    : {},
  instructions: 'Use oud and flute.',
  items: [{
    kind: 'user' as const,
    text: 'A full-length three-minute desert welcome with a wordless choir.',
  }],
})

for (let name of ['elevenlabs/music-v2', 'minimax/music-2.6']) {
  test(`${name} preserves music direction and stores audio at its tariff`, async () => {
    let input: unknown, sent: string | undefined, downloads = 0
    let options: unknown
    let blobs = memoryBlobs()
    let model = workersAi({
      run: (name, body, opts) => {
        options = opts
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
    let reply = await model({ ...ask(name), conversation: 'pilot' })
    assertEquals(options, {
      gateway: { id: 'default' },
      returnRawResponse: true,
      extraHeaders: { 'x-session-affinity': 'pilot' },
    })
    assertEquals(sent, name)
    assertEquals(
      input,
      name == 'elevenlabs/music-v2'
        ? {
          prompt: 'Use oud and flute.\n\n' +
            'A full-length three-minute desert welcome with a wordless choir.',
          output_format: 'mp3_48000_192',
        }
        : {
          prompt: 'Use oud and flute.\n\n' +
            'A full-length three-minute desert welcome with a wordless choir.',
          lyrics: '[Chorus]\nOoh\nAh',
          lyrics_optimizer: false,
          is_instrumental: false,
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

test('duration and voice words remain prompt directions, not parsed flags', () => {
  for (let model of ['elevenlabs/music-v2', 'minimax/music-2.6']) {
    for (
      let text of [
        'A 45-second instrumental interlude. No vocals.',
        'A full-length five-minute song: instrumental opening, then a choir.',
      ]
    ) {
      let req = { ...ask(model), items: [{ kind: 'user' as const, text }] }
      assertEquals(
        musicInput(req),
        model == 'elevenlabs/music-v2'
          ? {
            prompt: `Use oud and flute.\n\n${text}`,
            output_format: 'mp3_48000_192',
          }
          : {
            prompt: `Use oud and flute.\n\n${text}`,
            lyrics: '[Chorus]\nOoh\nAh',
            lyrics_optimizer: false,
            is_instrumental: false,
            format: 'mp3',
          },
      )
    }
  }
})

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

// This is the body workerd otherwise reduces to "7003: User Input Error".
test('music keeps raw gateway errors and never downloads or stores on refusal', async () => {
  let body = JSON.stringify({
    name: 'AiGatewayError',
    internalCode: 7003,
    description: 'User Input Error',
    errors: [{ message: 'lyrics required when is_instrumental is false' }],
  })
  let downloads = 0, stores = 0
  let model = workersAi({
    run: (_, __, options) => {
      assertEquals(options?.returnRawResponse, true)
      return Promise.resolve(new Response(body, { status: 400 }))
    },
  }, {
    media: {
      store: () => {
        stores++
        throw new Error('not reached')
      },
    },
    fetch: () => {
      downloads++
      throw new Error('not reached')
    },
  })
  let error = await assertRejects(() => model(ask('minimax/music-2.6')))
  assertEquals(error.name, 'AiGatewayError')
  assertEquals(error.message, `Workers AI HTTP 400: ${body}`)
  assertEquals(error.stack?.includes(body), true)
  assertEquals([downloads, stores], [0, 0])
})

test('music decodes a successful raw binding envelope and prices its bytes', async () => {
  let model = workersAi({
    run: () =>
      Promise.resolve(Response.json({
        state: 'Completed',
        result: { audio: 'https://audio.example/song.mp3' },
      })),
  }, {
    media: { store: artifactStore(memoryBlobs()) },
    fetch: () => Promise.resolve(new Response(mp3())),
  })
  let reply = await model(ask('elevenlabs/music-v2'))
  assertAlmostEquals(reply.cost!, 0.075)
  assertEquals(reply.artifacts?.[0].media_type, 'audio/mpeg')
})

test('MiniMax requires explicit vocal inputs before making a paid request', async () => {
  let calls = 0
  let model = workersAi({
    run: () => {
      calls++
      throw new Error('not reached')
    },
  }, { media: { store: artifactStore(memoryBlobs()) } })
  await assertRejects(
    () => model({ ...ask('minimax/music-2.6'), input: undefined }),
    ModelError,
    'MiniMax vocals require input.lyrics',
  )
  assertEquals(calls, 0)
  for (
    let input of [
      { lyrics: '[Chorus]\nOoh\nAh' },
      { lyrics_optimizer: true },
      { is_instrumental: true },
    ]
  ) {
    let sent = musicInput({ ...ask('minimax/music-2.6'), input })
    for (let [key, value] of Object.entries(input)) {
      assertEquals(sent[key], value)
    }
  }
})

test('ElevenLabs takes caller duration without parsing it from the prompt', () => {
  let sent = musicInput({
    ...ask('elevenlabs/music-v2'),
    input: { music_length_ms: 180000, force_instrumental: false },
  })
  assertEquals(sent.music_length_ms, 180000)
  assertEquals(sent.force_instrumental, false)
})
