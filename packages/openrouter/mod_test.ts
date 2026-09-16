import { assert, assertEquals, assertRejects } from '@std/assert'
import type { TextDelta } from '@yaks/model'
import { responses } from './mod.ts'
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

Deno.test('vision input uses Responses image parts, provider failures are not retried during streaming', async () => {
  let calls = 0
  const model = responses({
    key: () => 'private-key',
    fetch: (_url, init) => {
      calls++
      const body = JSON.parse(String(init?.body))
      assertEquals(body.input[0].content[0].type, 'input_image')
      assertEquals(
        body.input[0].content[0].image_url,
        'data:image/png;base64,AQID',
      )
      return Promise.resolve(
        Response.json({
          error: { message: 'not supported', code: 'unsupported_model' },
        }, { status: 400 }),
      )
    },
  })
  await assertRejects(() =>
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
    })
  )
  assertEquals(calls, 1)
})
