// The Responses client against scripted SSE: provider drift and secret
// boundaries are transport facts, so every case stops before runner logic.
import { assertEquals, assertRejects } from '@std/assert'
import { ResponseEvent, ResponseFault, responses } from './responses.ts'

let sse = (...events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    {
      headers: {
        'content-type': 'text/event-stream',
        'x-ratelimit-remaining-requests': '9',
      },
    },
  )

let complete = (
  items: Record<string, unknown>[] = [],
  extra: Record<string, unknown> = {},
) =>
  sse(
    { type: 'response.created', response: { status: 'in_progress' } },
    ...items.map((item) => ({ type: 'response.output_item.done', item })),
    {
      type: 'response.completed',
      response: {
        status: 'completed',
        model: 'gpt-5.6-sol-2026-08-01',
        usage: {
          input_tokens: 12,
          input_tokens_details: { cached_tokens: 5 },
          output_tokens: 7,
          output_tokens_details: { reasoning_tokens: 3 },
        },
        ...extra,
      },
    },
  )

let auth = (refresh?: () => Promise<{ token: string; account?: string }>) => ({
  get: () => Promise.resolve({ token: 'secret-old', account: 'acct-1' }),
  refresh,
})

Deno.test('responses keeps completed items, replay state, usage, and deltas', async () => {
  let init: RequestInit | undefined
  let streamed: string[] = []
  let client = responses({
    credentials: auth(),
    id: () => 'request-1',
    fetch: (_input, value) => {
      init = value
      return Promise.resolve(sse(
        { type: 'response.output_text.delta', delta: 'hi' },
        {
          type: 'response.output_item.done',
          item: {
            type: 'reasoning',
            id: 'reason-1',
            encrypted_content: 'opaque',
          },
        },
        {
          type: 'response.output_item.done',
          item: {
            type: 'message',
            id: 'message-1',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'hi' }],
          },
        },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            model: 'gpt-5.6-sol-2026-08-01',
            output: [],
            usage: {
              input_tokens: 12,
              input_tokens_details: { cached_tokens: 5 },
              output_tokens: 7,
              output_tokens_details: { reasoning_tokens: 3 },
            },
          },
        },
      ))
    },
  })
  let out = await client.run({
    model: 'gpt-5.6-sol',
    instructions: 'developer words',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'hello' },
        { type: 'input_image', image_url: 'data:image/png;base64,eA==' },
      ],
    }],
    tools: [{ type: 'function', name: 'marker' }],
    parallel_tool_calls: true,
    reasoning: { effort: 'high' },
    context_management: [{ type: 'compaction', compact_threshold: 1000 }],
    prompt_cache_key: 'stable',
  }, { event: (event) => streamed.push(event.type) })

  let headers = new Headers(init?.headers)
  let body = JSON.parse(String(init?.body))
  assertEquals(headers.get('authorization'), 'Bearer secret-old')
  assertEquals(headers.get('chatgpt-account-id'), 'acct-1')
  assertEquals(headers.get('x-client-request-id'), 'request-1')
  assertEquals(String(init?.body).includes('secret-old'), false)
  assertEquals(body.store, false)
  assertEquals(body.stream, true)
  assertEquals(body.include, ['reasoning.encrypted_content'])
  assertEquals(body.instructions, 'developer words')
  assertEquals(body.input[0].content[1].type, 'input_image')
  assertEquals(body.parallel_tool_calls, true)
  assertEquals(body.reasoning, { effort: 'high' })
  assertEquals(body.context_management, [{
    type: 'compaction',
    compact_threshold: 1000,
  }])
  assertEquals(body.prompt_cache_key, 'stable')
  assertEquals(streamed[0], 'response.output_text.delta')
  assertEquals(out.items.map((item) => item.type), ['reasoning', 'message'])
  assertEquals(out.items[1].phase, 'final_answer')
  assertEquals(out.usage, {
    input: 12,
    cached: 5,
    output: 7,
    reasoning: 3,
    raw: {
      input_tokens: 12,
      input_tokens_details: { cached_tokens: 5 },
      output_tokens: 7,
      output_tokens_details: { reasoning_tokens: 3 },
    },
  })
  assertEquals(out.limits, { 'x-ratelimit-remaining-requests': '9' })
})

Deno.test('responses round trips a correlated function result without provider state', async () => {
  let bodies: Record<string, unknown>[] = []
  let call = {
    type: 'function_call',
    id: 'item-1',
    call_id: 'call-1',
    name: 'marker',
    arguments: '{"value":1}',
  }
  let other = {
    ...call,
    id: 'item-2',
    call_id: 'call-2',
    arguments: '{"value":2}',
  }
  let replies = [
    complete([call, other]),
    complete([{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'done' }],
    }]),
  ]
  let client = responses({
    credentials: auth(),
    fetch: (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Promise.resolve(replies.shift()!)
    },
  })
  let first = await client.run({ model: 'gpt-5.6-sol', input: ['start'] })
  await client.run({
    model: 'gpt-5.6-sol',
    input: [
      ...first.items,
      { type: 'function_call_output', call_id: 'call-1', output: 'ok' },
      { type: 'function_call_output', call_id: 'call-2', output: 'also ok' },
    ],
  })
  assertEquals(bodies[1].input, [
    call,
    other,
    { type: 'function_call_output', call_id: 'call-1', output: 'ok' },
    { type: 'function_call_output', call_id: 'call-2', output: 'also ok' },
  ])
  assertEquals('previous_response_id' in bodies[1], false)
})

Deno.test('responses retains well-formed unknown events and items by name', async () => {
  let future = { type: 'response.future.delta', payload: { x: 1 } }
  let item = { type: 'future_item', payload: { y: 2 } }
  let client = responses({
    credentials: auth(),
    fetch: () =>
      Promise.resolve(sse(
        future,
        { type: 'response.output_item.done', item },
        {
          type: 'response.completed',
          response: { status: 'completed', model: 'future-model' },
        },
      )),
  })
  let out = await client.run({ model: 'wanted', input: [] })
  assertEquals(out.unknown, [future])
  assertEquals(out.unknownItems, [item])
  assertEquals(out.items, [item])
})

Deno.test('responses rejects malformed stream data and missing item types', async () => {
  let malformed = responses({
    credentials: auth(),
    fetch: () => Promise.resolve(new Response('data: {no}\n\n')),
  })
  await assertRejects(
    () => malformed.run({ model: 'm', input: [] }),
    Error,
    'malformed SSE data',
  )

  let noType = responses({
    credentials: auth(),
    fetch: () =>
      Promise.resolve(sse(
        { type: 'response.output_item.done', item: { id: 'x' } },
        {
          type: 'response.completed',
          response: { status: 'completed', model: 'm' },
        },
      )),
  })
  await assertRejects(
    () => noType.run({ model: 'm', input: [] }),
    Error,
    'completed item has no type',
  )
})

Deno.test('responses scrubs failed-stream evidence and credential errors', async () => {
  let failed = responses({
    credentials: auth(),
    fetch: () =>
      Promise.resolve(sse(
        { type: 'response.future.delta', value: 'secret-old' },
        {
          type: 'response.output_item.done',
          item: { type: 'message', content: 'before failure' },
        },
        {
          type: 'response.failed',
          response: {
            status: 'failed',
            error: { code: 'schema_changed', message: 'acct-1 secret-old' },
          },
        },
      )),
  })
  let error = await assertRejects(
    () => failed.run({ model: 'm', input: [] }),
  ) as ResponseFault
  assertEquals(error.message, 'responses: failed')
  assertEquals(error.code, 'schema_changed')
  assertEquals(error.items?.length, 1)
  assertEquals(JSON.stringify(error.evidence).includes('secret-old'), false)
  assertEquals(JSON.stringify(error.evidence).includes('acct-1'), false)

  let unavailable = responses({
    credentials: {
      get: () => Promise.reject(new Error('secret-old')),
    },
  })
  await assertRejects(
    () => unavailable.run({ model: 'm', input: [] }),
    Error,
    'credential unavailable',
  )
})

Deno.test('responses refreshes once on 401 and never returns credentials', async () => {
  let calls = 0
  let refreshed = 0
  let client = responses({
    credentials: auth(() => {
      refreshed++
      return Promise.resolve({ token: 'secret-new', account: 'acct-2' })
    }),
    fetch: (_input, init) => {
      calls++
      let headers = new Headers(init?.headers)
      if (calls == 1) {
        assertEquals(headers.get('authorization'), 'Bearer secret-old')
        return Promise.resolve(
          new Response(
            '{"error":{"code":"expired","message":"secret-old acct-1"}}',
            { status: 401 },
          ),
        )
      }
      assertEquals(headers.get('authorization'), 'Bearer secret-new')
      assertEquals(headers.get('chatgpt-account-id'), 'acct-2')
      return Promise.resolve(complete())
    },
  })
  let out = await client.run({ model: 'm', input: [] })
  assertEquals(calls, 2)
  assertEquals(refreshed, 1)
  assertEquals(JSON.stringify(out).includes('secret-'), false)
  assertEquals(JSON.stringify(out).includes('acct-'), false)
})

Deno.test('responses names 429 limits without retrying or echoing errors', async () => {
  let calls = 0
  let client = responses({
    credentials: auth(),
    fetch: () => {
      calls++
      return Promise.resolve(
        new Response(
          '{"error":{"code":"rate_limit","message":"secret-old"}}',
          {
            status: 429,
            headers: {
              'retry-after': '2',
              'x-ratelimit-remaining-requests': '0',
              'x-request-id': 'private-trace',
            },
          },
        ),
      )
    },
  })
  let error = await assertRejects(
    () => client.run({ model: 'm', input: [] }),
  ) as ResponseFault
  assertEquals(calls, 1)
  assertEquals(error.message, 'responses: HTTP 429')
  assertEquals(error.code, 'rate_limit')
  assertEquals(error.limits, {
    'retry-after': '2',
    'x-ratelimit-remaining-requests': '0',
  })
  assertEquals(JSON.stringify(error).includes('secret-old'), false)
  assertEquals(JSON.stringify(error).includes('private-trace'), false)
})

Deno.test('responses retries bounded server failures before reading events', async () => {
  let calls = 0
  let pauses: number[] = []
  let client = responses({
    credentials: auth(),
    retries: 2,
    pause: (ms) => {
      pauses.push(ms)
      return Promise.resolve()
    },
    fetch: () => {
      calls++
      return Promise.resolve(
        calls < 3
          ? new Response('', { status: calls == 1 ? 500 : 503 })
          : complete(),
      )
    },
  })
  await client.run({ model: 'm', input: [] })
  assertEquals(calls, 3)
  assertEquals(pauses, [200, 400])
})

Deno.test('responses aborts an active stream without retrying', async () => {
  let controller = new AbortController()
  let calls = 0
  let client = responses({
    credentials: auth(),
    fetch: (_input, init) => {
      calls++
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode(
                'data: {"type":"response.created"}\n\n',
              ))
              init?.signal?.addEventListener('abort', () => {
                stream.error(new DOMException('cancelled', 'AbortError'))
              })
            },
          }),
        ),
      )
    },
  })
  let run = client.run(
    { model: 'm', input: [] },
    {
      signal: controller.signal,
      event: (_event: ResponseEvent) => controller.abort(),
    },
  )
  await assertRejects(() => run, DOMException, 'cancelled')
  assertEquals(calls, 1)
})
