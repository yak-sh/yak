import { assertEquals, assertRejects } from '@std/assert'
import { ollamaCloudReady, ollamaCloudTransport } from './ollama_cloud.ts'

let complete = () =>
  new Response(
    [
      { type: 'response.created', response: { status: 'in_progress' } },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          model: 'kimi-k2.7-code',
          output: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )

Deno.test('ollama cloud calls the hosted Responses API with bearer auth', async () => {
  let input: string | URL | Request = ''
  let init: RequestInit | undefined
  let client = ollamaCloudTransport({
    fetch: (url, value) => {
      input = url
      init = value
      return Promise.resolve(complete())
    },
  }, () => 'cloud-secret')

  let result = await client.run({
    model: 'kimi-k2.7-code',
    input: 'hello',
    instructions: 'use tools',
    tools: [{ type: 'function', name: 'graph_query' }],
  })

  assertEquals(String(input), 'https://ollama.com/v1/responses')
  assertEquals(
    new Headers(init?.headers).get('authorization'),
    'Bearer cloud-secret',
  )
  assertEquals(String(init?.body).includes('cloud-secret'), false)
  let body = JSON.parse(String(init?.body))
  assertEquals(body.model, 'kimi-k2.7-code')
  assertEquals(body.stream, true)
  assertEquals(body.instructions, 'use tools')
  assertEquals(body.tools, [{ type: 'function', name: 'graph_query' }])
  assertEquals('include' in body, false)
  assertEquals('store' in body, false)
  assertEquals(result.model, 'kimi-k2.7-code')
})

Deno.test('ollama cloud readiness and missing credentials stay at the edge', async () => {
  assertEquals(ollamaCloudReady(() => ' key '), true)
  assertEquals(ollamaCloudReady(() => '  '), false)
  await assertRejects(
    () =>
      ollamaCloudTransport({ retries: 0 }, () => undefined).run({
        model: 'kimi-k2.7-code',
        input: 'hello',
      }),
    Error,
    'credential unavailable',
  )
})
