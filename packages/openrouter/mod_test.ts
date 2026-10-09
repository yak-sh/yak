import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { ModelError, type TextDelta } from '@yaks/model'
import { responses } from './mod.ts'
import { generationCost } from './cost.ts'
import { artifactStore, memoryBlobs } from '@yaks/blob'
const sse = (events: unknown[]) =>
  new Response(
    events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )
const events = [
  { type: 'response.output_text.delta', item_id: 'm1', delta: 'Hello' },
  {
    type: 'response.output_item.done',
    item: {
      id: 'm1',
      type: 'message',
      content: [{ type: 'output_text', text: 'Hello' }],
    },
  },
  {
    type: 'response.output_item.done',
    item: {
      type: 'function_call',
      call_id: 'c1',
      name: 'lookup',
      arguments: '{"q":"x"}',
    },
  },
  {
    type: 'response.completed',
    response: {
      id: 'or-1',
      model: 'vendor/model',
      status: 'completed',
      usage: {
        input_tokens: 10,
        output_tokens: 3,
        total_tokens: 13,
        input_tokens_details: { cached_tokens: 4 },
        cost: 0.00042,
      },
    },
  },
]
test('OpenRouter shares Responses transport but not credentials, anchors or native tools', async () => {
  const seen: Record<string, unknown>[] = []
  const model = responses({
    speech: [],
    key: () => 'test-key',
    fetch: (url, init) => {
      assertEquals(url, 'https://openrouter.ai/api/v1/responses')
      assertEquals(
        new Headers(init?.headers).get('authorization'),
        'Bearer test-key',
      )
      assertEquals(new Headers(init?.headers).get('chatgpt-account-id'), null)
      seen.push(JSON.parse(String(init?.body)))
      return Promise.resolve(sse(events))
    },
  })
  const deltas: TextDelta[] = []
  const reply = await model({
    model: 'vendor/model',
    anchor: 'must-not-send',
    items: [{ kind: 'user', text: 'hi' }],
    tools: [{
      name: 'lookup',
      description: 'Lookup',
      parameters: { type: 'object' },
    }],
    onText: (v) => deltas.push(v),
  })
  assertEquals(seen[0].previous_response_id, undefined)
  assertEquals(seen[0].store, false)
  assertEquals((seen[0].tools as { type: string }[]).map((t) => t.type), [
    'function',
  ])
  assertEquals(deltas[0].text, 'Hello')
  assertEquals(reply.usage?.cached_tokens, 4)
  assertEquals(reply.cost, 0.00042)
  assertEquals(reply.items[1], {
    kind: 'call',
    id: 'c1',
    name: 'lookup',
    args: '{"q":"x"}',
  })
  assertEquals(model.anchor, undefined)
  assertEquals(model.mark?.(reply), {
    openrouter: { response_id: 'or-1', cache_expires_at: null },
  })
  await model({
    model: 'vendor/model',
    items: [{ kind: 'user', text: 'hi' }, ...reply.items, {
      kind: 'result',
      id: 'c1',
      output: 'found',
    }],
    tools: [],
  })
  assert(
    (seen[1].input as { type: string }[]).some((i) =>
      i.type === 'function_call_output'
    ),
  )
})
test('OpenRouter propagates cancellation without replaying streaming calls', async () => {
  let calls = 0
  const controller = new AbortController()
  const model = responses({
    speech: [],
    key: () => 'test',
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        calls++
        init!.signal!.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        )
        controller.abort()
      }),
  })
  await assertRejects(() =>
    model({
      model: 'vendor/model',
      items: [],
      tools: [],
      signal: controller.signal,
      onText: () => {},
    })
  )
  assertEquals(calls, 1)
})

test('vision input uses Responses image parts and HTTP 400 fails without retry', async () => {
  let seen: Record<string, unknown>[] = []
  const model = responses({
    speech: [],
    key: () => 'private-key',
    fetch: (_url, init) => {
      seen.push(JSON.parse(String(init?.body)))
      return Promise.resolve(
        Response.json({
          error: { message: 'not supported', code: 'unsupported_model' },
        }, { status: 400 }),
      )
    },
  })
  let error = await assertRejects(
    () =>
      model({
        model: 'vendor/model',
        tools: [],
        onText: () => {},
        items: [{
          kind: 'image',
          mediaType: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
          label: 'test',
        }],
      }),
    ModelError,
    'not supported',
  )
  assertEquals(error.code, 'unsupported_model')
  assertEquals(seen.length, 1)
  let input = seen[0].input as { content: unknown[] }[]
  assertEquals(input[0].content, [
    { type: 'input_text', text: 'test' },
    { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
  ])
})

test('streamed OpenRouter audio becomes one blob artifact with no encoded bytes in the reply', async () => {
  let bytes = new TextEncoder().encode('ID3generated music')
  let encoded = btoa(String.fromCharCode(...bytes))
  let seen: Record<string, unknown> = {}
  let model = responses({
    speech: [],
    key: () => 'test-key',
    media: { store: artifactStore(memoryBlobs()) },
    fetch: (url, init) => {
      assertEquals(url, 'https://openrouter.ai/api/v1/chat/completions')
      assertEquals(
        new Headers(init?.headers).get('x-session-id'),
        'music-session',
      )
      seen = JSON.parse(String(init?.body))
      let frames = [
        {
          id: 'song-1',
          model: 'google/lyria-3-clip-preview',
          choices: [{
            delta: {
              audio: { data: encoded.slice(0, 5), transcript: 'A tune' },
            },
          }],
        },
        {
          choices: [{ delta: { audio: { data: encoded.slice(5) } } }],
          usage: { cost: 0.24 },
        },
      ]
      return Promise.resolve(
        new Response(
          frames.map((f) => 'data: ' + JSON.stringify(f) + '\n\n').join('') +
            'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    },
  })
  let reply = await model({
    model: 'google/lyria-3-clip-preview',
    conversation: 'music-session',
    modalities: ['text', 'audio'],
    items: [{ kind: 'user', text: 'An instrumental melody' }],
    tools: [],
  })
  assertEquals(seen.session_id, 'music-session')
  assertEquals(seen.modalities, ['text', 'audio'])
  assertEquals(seen.audio, { format: 'mp3' })
  assertEquals(seen.stream, true)
  assertEquals(reply.cost, 0.24)
  assertEquals(reply.items, [{ kind: 'assistant', text: 'A tune' }])
  assertEquals(reply.artifacts?.[0].media_type, 'audio/mpeg')
  assertEquals(reply.artifacts?.[0].size, bytes.length)
  assert(!JSON.stringify(reply).includes(encoded))
})

test('OpenRouter image output shares the artifact path', async () => {
  let png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII='
  let model = responses({
    speech: [],
    key: () => 'test',
    media: { store: artifactStore(memoryBlobs()) },
    fetch: (_url, init) => {
      let request = JSON.parse(String(init?.body))
      assertEquals(request.modalities, ['text', 'image'])
      return Promise.resolve(Response.json({
        id: 'picture-1',
        model: 'image-model',
        choices: [{
          message: {
            content: 'A tree',
            images: [{ image_url: { url: 'data:image/png;base64,' + png } }],
          },
        }],
      }))
    },
  })
  let reply = await model({
    model: 'image-model',
    modalities: ['text', 'image'],
    items: [{ kind: 'user', text: 'A tree' }],
    tools: [],
  })
  assertEquals(reply.items, [{ kind: 'assistant', text: 'A tree' }])
  assertEquals(reply.artifacts?.[0].media_type, 'image/png')
  assert(!JSON.stringify(reply).includes(png))
})

test('a speech model uses the audio door and stores its bytes as an artifact', async () => {
  let bytes = new Uint8Array([
    0xff,
    0xfb,
    0x90,
    0x64,
    ...new Array(400).fill(0),
  ])
  let model = responses({
    key: () => 'probe-key',
    speech: ['vendor/speech'],
    media: { store: artifactStore(memoryBlobs()) },
    fetch: (url, init) => {
      if (String(url).includes('/generation?')) {
        assertEquals(
          new Headers(init?.headers).get('authorization'),
          'Bearer probe-key',
        )
        return Promise.resolve(Response.json({ data: { total_cost: 0.0123 } }))
      }
      assertEquals(url, 'https://openrouter.ai/api/v1/audio/speech')
      assertEquals(
        new Headers(init?.headers).get('x-session-id'),
        'speech-session',
      )
      assertEquals(
        new Headers(init?.headers).get('authorization'),
        'Bearer probe-key',
      )
      assertEquals(JSON.parse(String(init?.body)), {
        model: 'vendor/speech',
        input: 'A forge hammer ringing',
        response_format: 'mp3',
      })
      return Promise.resolve(
        new Response(bytes, {
          headers: { 'x-generation-id': 'gen-1', 'content-type': 'audio/mpeg' },
        }),
      )
    },
  })
  let reply = await model({
    model: 'vendor/speech',
    conversation: 'speech-session',
    modalities: ['audio'],
    items: [{ kind: 'user', text: 'A forge hammer ringing' }],
    tools: [],
  })
  assertEquals(reply.cost, 0.0123)
  assertEquals(reply.id, 'gen-1')
  assertEquals(reply.artifacts?.[0].media_type, 'audio/mpeg')
  assertEquals(reply.artifacts?.[0].size, bytes.length)
  assert(!JSON.stringify(reply).includes('255,251,144,100'))
})

test('media connection faults are bounded without exposing credentials', async () => {
  let model = responses({
    speech: [],
    key: () => 'private-test-key',
    media: { store: artifactStore(memoryBlobs()) },
    fetch: () => Promise.reject(new Error('private-test-key')),
  })
  let error = await assertRejects(
    () =>
      model({
        model: 'google/lyria-3-clip-preview',
        modalities: ['text', 'audio'],
        items: [{ kind: 'user', text: 'music' }],
        tools: [],
      }),
    Error,
    'OpenRouter media connection failed',
  )
  assert(error instanceof ModelError)
  assertEquals(error.retry, { after: 0 })
})

test('media HTTP failures tell the session which ones can retry', async () => {
  for (let status of [400, 503]) {
    let model = responses({
      speech: [],
      key: () => 'fake',
      media: { store: artifactStore(memoryBlobs()) },
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: 'unavailable' } }),
            { status },
          ),
        ),
    })
    let error = await assertRejects(() =>
      model({
        model: 'google/lyria-3-clip-preview',
        modalities: ['text', 'audio'],
        items: [{ kind: 'user', text: 'music' }],
        tools: [],
      })
    )
    assert(error instanceof ModelError)
    assertEquals(error.retry, status == 503 ? { after: 0 } : undefined)
  }
})

test('audio with no inline bill queries its generation without regenerating', async () => {
  let posts = 0, reads = 0
  let model = responses({
    speech: [],
    key: () => 'fixture-key',
    media: { store: artifactStore(memoryBlobs()) },
    fetch: (url, init) => {
      if (String(url).includes('/generation?')) {
        reads++
        assertEquals(
          new Headers(init?.headers).get('authorization'),
          'Bearer fixture-key',
        )
        return Promise.resolve(Response.json({ data: { total_cost: 0.08 } }))
      }
      posts++
      return Promise.resolve(
        new Response(
          [
            'data: ' + JSON.stringify({ id: 'lyria-1', choices: [] }),
            'data: [DONE]',
            '',
          ].join('\n\n'),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    },
  })
  let reply = await model({
    model: 'google/lyria-3-pro-preview',
    modalities: ['audio'],
    items: [{ kind: 'user', text: 'A quiet tune' }],
    tools: [],
  })
  assertEquals(reply.cost, 0.08)
  assertEquals([posts, reads], [1, 1])
})

test('generation metadata lag retries only lookup and obeys cancellation', async () => {
  let reads = 0
  let cost = await generationCost('already-generated', {
    key: () => 'fixture',
    fetch: () =>
      Promise.resolve(
        ++reads == 1
          ? new Response('', { status: 404 })
          : Response.json({ data: { total_cost: 0.05 } }),
      ),
  })
  assertEquals([cost, reads], [0.05, 2])
  let controller = new AbortController()
  await assertRejects(() =>
    generationCost('already-generated', {
      key: () => 'fixture',
      signal: controller.signal,
      fetch: () => {
        controller.abort(new DOMException('cancelled', 'AbortError'))
        return Promise.resolve(new Response('', { status: 404 }))
      },
    }), DOMException)
})

test('explicit prefix expiry is recorded through Responses and chat, not response-cache TTL', async () => {
  for (let modelName of ['vendor/model', 'qwen/qwen3-max']) {
    let model = responses({
      key: () => 'mock',
      speech: [],
      fetch: () =>
        Promise.resolve(
          modelName.startsWith('qwen/')
            ? sse([{
              id: 'r',
              model: modelName,
              cache_expires_at: 1791021900,
              choices: [],
            }])
            : sse([{
              type: 'response.completed',
              response: {
                id: 'r',
                model: modelName,
                status: 'completed',
                cache_expires_at: 1791021900,
              },
            }]),
        ),
    })
    let reply = await model({ model: modelName, items: [], tools: [] })
    assertEquals(
      model.mark?.(reply)?.openrouter.cache_expires_at,
      '2026-10-03T10:05:00.000Z',
    )
  }
})
