import { assert, assertEquals, assertRejects } from '@std/assert'
import { artifactStore, type Blobs } from '@yaks/blob'
import { generatedImages } from './images.ts'
import { body, responses } from './responses.ts'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII='
let memory = () => {
  let rows = new Map<string, Uint8Array>()
  let puts = 0
  let blobs: Blobs = {
    has: (k) => rows.has(k),
    get: (k) => rows.get(k),
    put: (k, v) => {
      puts++
      rows.set(k, v)
    },
  }
  return { blobs, rows, puts: () => puts }
}
let call = (extra = {}) => ({
  type: 'image_generation_call',
  id: 'ig_123',
  status: 'completed',
  result: png,
  revised_prompt: 'a tiny image',
  ...extra,
})

Deno.test('native image tool composes with functions and stores exact deduplicated bytes', async () => {
  let m = memory(), options = { store: artifactStore(m.blobs) }
  let req = {
    model: 'gpt-4.1',
    items: [],
    tools: [{ name: 'echo', description: '', parameters: {} }],
  }
  assertEquals((body(req, false, options).tools as unknown[]).length, 2)
  assertEquals((body(req, false).tools as unknown[]).length, 1)
  let artifacts = await generatedImages(
    [call(), call({ id: 'ig_124' })],
    options,
  )
  assertEquals(artifacts.length, 2)
  assertEquals(m.puts(), 1)
  assertEquals(
    m.rows.get(artifacts[0].address),
    Uint8Array.from(atob(png), (c) => c.charCodeAt(0)),
  )
  assertEquals(artifacts[0].media_type, 'image/png')
  assertEquals(artifacts[0].revised_prompt, 'a tiny image')
  assert(!JSON.stringify(artifacts).includes(png))
})

Deno.test('malformed, incomplete, oversized and failed storage produce bounded errors', async () => {
  let m = memory(), options = { store: artifactStore(m.blobs) }
  for (
    let extra of [
      { result: 'secret malformed' },
      { status: 'failed' },
      { output_format: 'gif' },
      { result: btoa('not an image') },
      { id: '' },
    ]
  ) {
    await assertRejects(() => generatedImages([call(extra)], options))
  }
  await assertRejects(() =>
    generatedImages([call()], { ...options, maxBytes: 2 })
  )
  await assertRejects(() => generatedImages([call()], undefined))
  await assertRejects(
    () =>
      generatedImages([call()], {
        store: () => {
          throw new Error(png)
        },
      }),
    Error,
    'Could not persist',
  )
  assertEquals(m.puts(), 0)
})

Deno.test('streamed image output persists before reply and event observers never see base64', async () => {
  let m = memory(), observed: unknown[] = []
  let frames = [
    { type: 'response.output_item.done', item: call() },
    {
      type: 'response.completed',
      response: {
        id: 'r1',
        status: 'completed',
        model: 'gpt-4.1',
        output: [call()],
      },
    },
  ]
  let model = responses({
    web: false,
    credential: () => ({ token: 'key', base: 'https://api.openai.com/v1' }),
    images: { store: artifactStore(m.blobs) },
    event: (e) => observed.push(e),
    fetch: (() =>
      Promise.resolve(
        new Response(
          frames.map((f) => 'data: ' + JSON.stringify(f) + '\n\n').join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )) as typeof fetch,
  })
  let reply = await model({
    model: 'gpt-4.1',
    items: [{ kind: 'user', text: 'draw' }],
    tools: [],
  })
  assertEquals(reply.artifacts?.length, 1)
  assert(!JSON.stringify(reply).includes(png))
  assert(!JSON.stringify(observed).includes(png))
  assertEquals(m.puts(), 1)
})

Deno.test('JPEG and WebP output honor format settings and mixed output stays separate', async () => {
  let m = memory()
  for (
    let [format, bytes] of [
      ['jpeg', new Uint8Array([255, 216, 255, 224])],
      ['webp', new TextEncoder().encode('RIFF0000WEBP')],
    ] as const
  ) {
    let output = await generatedImages([
      { type: 'message', content: [] },
      {
        type: 'function_call',
        call_id: 'function-1',
        name: 'echo',
        arguments: '{}',
      },
      call({
        result: btoa(String.fromCharCode(...bytes)),
        output_format: format,
      }),
    ], { store: artifactStore(m.blobs) })
    assertEquals(output[0].media_type, 'image/' + format)
    assertEquals(output[0].size, bytes.length)
  }
})

Deno.test('configured image tools are offered on OAuth, unknown models and custom endpoints', async () => {
  for (
    let [name, endpoint, auto, expected] of [
      ['gpt-4.1', 'https://api.openai.com/v1', true, true],
      ['gpt-4.1-2025-04-14', 'https://api.openai.com/v1', true, true],
      ['gpt-5.5', 'https://api.openai.com/v1/', true, true],
      ['gpt-6-astra', 'https://api.openai.com/v1', true, true],
      ['gpt-4.1', 'https://chatgpt.com/backend-api/codex', true, true],
      ['gpt-4.1', 'https://proxy.example/v1', true, true],
      ['custom', 'https://proxy.example/v1', false, true],
    ] as const
  ) {
    let sent: Record<string, unknown>[] = []
    let model = responses({
      web: false,
      credential: () => ({ token: 'test', base: endpoint }),
      images: { auto, store: artifactStore(memory().blobs) },
      fetch: ((_url, init) => {
        sent.push(JSON.parse(String(init?.body)))
        return Promise.resolve(
          new Response(
            'data: ' + JSON.stringify({
              type: 'response.completed',
              response: {
                id: 'r',
                model: name,
                status: 'completed',
                output: [],
              },
            }) + '\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        )
      }) as typeof fetch,
    })
    await model({ model: name, items: [], tools: [] })
    assertEquals(sent[0].tools, expected ? [{ type: 'image_generation' }] : [])
    await model({ model: 'unknown', items: [], tools: [] })
    assertEquals(sent[1].tools, [{ type: 'image_generation' }])
  }
})

Deno.test('image-tool rejection propagates without stripping tools or caching a guess', async () => {
  for (let status of [400, 403]) {
    let sent: Record<string, unknown>[] = []
    let model = responses({
      web: false,
      credential: () => ({
        token: 'test',
        base: 'https://chatgpt.com/backend-api/codex',
      }),
      images: { store: artifactStore(memory().blobs) },
      fetch: ((_url, init) => {
        sent.push(JSON.parse(String(init?.body)))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                type: 'invalid_request_error',
                code: 'unsupported_value',
                param: 'tools[0].type',
                message: 'image_generation is not supported',
              },
            }),
            { status },
          ),
        )
      }) as typeof fetch,
    })
    for (let i = 0; i < 2; i++) {
      await assertRejects(
        () => model({ model: 'unknown', items: [], tools: [] }),
        Error,
        'image_generation is not supported',
      )
    }
    assertEquals(sent.length, 2)
    for (let request of sent) {
      assertEquals(request.tools, [{ type: 'image_generation' }])
    }
  }
})

Deno.test('unconfigured image tools remain disabled on OAuth', async () => {
  let sent: Record<string, unknown>[] = []
  let model = responses({
    web: false,
    credential: () => ({
      token: 'test',
      base: 'https://chatgpt.com/backend-api/codex',
    }),
    fetch: ((_url, init) => {
      sent.push(JSON.parse(String(init?.body)))
      return Promise.resolve(
        new Response(
          'data: ' + JSON.stringify({
            type: 'response.completed',
            response: {
              id: 'r',
              model: 'unknown',
              status: 'completed',
              output: [],
            },
          }) + '\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    }) as typeof fetch,
  })
  await model({ model: 'unknown', items: [], tools: [] })
  assertEquals(sent[0].tools, [])
})
