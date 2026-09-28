import { assert, assertEquals, assertRejects } from '@std/assert'
import { ModelError, type TextDelta } from '@yaks/model'
import { responses } from './mod.ts'
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
      },
    },
  },
]
Deno.test('OpenRouter shares Responses transport but not credentials, anchors or native tools', async () => {
  const seen: Record<string, unknown>[] = []
  const model = responses({
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
  assertEquals(reply.items[1], {
    kind: 'call',
    id: 'c1',
    name: 'lookup',
    args: '{"q":"x"}',
  })
  assertEquals(model.anchor, undefined)
  assertEquals(model.mark?.(reply), { openrouter: { response_id: 'or-1' } })
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
Deno.test('OpenRouter propagates cancellation without replaying streaming calls', async () => {
  let calls = 0
  const controller = new AbortController()
  const model = responses({
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

Deno.test('vision input uses Responses image parts and HTTP 400 fails without retry', async () => {
  let seen: Record<string, unknown>[] = []
  const model = responses({
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

Deno.test('streamed OpenRouter audio becomes one blob artifact with no encoded bytes in the reply', async () => {
  let bytes = new TextEncoder().encode('ID3generated music')
  let encoded = btoa(String.fromCharCode(...bytes))
  let seen: Record<string, unknown> = {}
  let model = responses({
    key: () => 'test-key',
    media: { store: artifactStore(memoryBlobs()) },
    fetch: (url, init) => {
      assertEquals(url, 'https://openrouter.ai/api/v1/chat/completions')
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
        { choices: [{ delta: { audio: { data: encoded.slice(5) } } }] },
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
    modalities: ['text', 'audio'],
    items: [{ kind: 'user', text: 'An instrumental melody' }],
    tools: [],
  })
  assertEquals(seen.modalities, ['text', 'audio'])
  assertEquals(seen.audio, { format: 'mp3' })
  assertEquals(seen.stream, true)
  assertEquals(reply.items, [{ kind: 'assistant', text: 'A tune' }])
  assertEquals(reply.artifacts?.[0].media_type, 'audio/mpeg')
  assertEquals(reply.artifacts?.[0].size, bytes.length)
  assert(!JSON.stringify(reply).includes(encoded))
})

Deno.test('OpenRouter image output shares the artifact path', async () => {
  let png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII='
  let model = responses({
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

Deno.test('a speech model uses the audio door and stores its bytes as an artifact', async () => {
  let bytes = new TextEncoder().encode('ID3sound')
  let model = responses({
    key: () => 'probe-key',
    speech: ['vendor/speech'],
    media: { store: artifactStore(memoryBlobs()) },
    fetch: (url, init) => {
      assertEquals(url, 'https://openrouter.ai/api/v1/audio/speech')
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
    modalities: ['audio'],
    items: [{ kind: 'user', text: 'A forge hammer ringing' }],
    tools: [],
  })
  assertEquals(reply.id, 'gen-1')
  assertEquals(reply.artifacts?.[0].media_type, 'audio/mpeg')
  assertEquals(reply.artifacts?.[0].size, bytes.length)
  assert(!JSON.stringify(reply).includes('ID3sound'))
})

Deno.test('media connection faults are bounded without exposing credentials', async () => {
  let model = responses({
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

Deno.test('media HTTP failures tell the session which ones can retry', async () => {
  for (let status of [400, 503]) {
    let model = responses({
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
