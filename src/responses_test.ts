// Tasks owns observation mapping and opts into credential redaction. Wire
// edge cases live with the implementation in @yaks/openai/transport_test.ts.
import { assertEquals } from '@std/assert'
import {
  type ResponseEvent,
  responseObservation,
  responses,
} from './responses.ts'

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

Deno.test('responses normalizes only useful typed observation fields', () => {
  assertEquals(
    responseObservation({
      type: 'response.output_text.delta',
      delta: 'hello',
      provider_payload: { hidden: true },
    }),
    { kind: 'model', text: 'hello' },
  )
  assertEquals(
    responseObservation({
      type: 'response.reasoning_summary_text.delta',
      delta: 'checking',
    }),
    { kind: 'reasoning', text: 'checking' },
  )
  assertEquals(
    responseObservation({
      type: 'response.output_item.added',
      item: {
        type: 'function_call',
        name: 'shell',
        arguments: 'do not relay',
        call_id: 'provider-id',
      },
    }),
    { kind: 'tool', name: 'shell' },
  )
  assertEquals(
    responseObservation({
      type: 'response.function_call_arguments.delta',
      delta: '{"secret":"not observed"}',
    }),
    undefined,
  )
  assertEquals(
    responseObservation({
      type: 'response.future.delta',
      payload: 'not observed',
    }),
    undefined,
  )
})

Deno.test('responses refreshes once on 401 and never returns credentials', async () => {
  let calls = 0
  let refreshed = 0
  let observed: ResponseEvent[] = []
  let client = responses({
    credentials: {
      get: () =>
        Promise.resolve({
          token: 'secret-old',
          account: 'acct-1',
          base: 'https://chatgpt.example/codex',
        }),
      refresh: () => {
        refreshed++
        return Promise.resolve({
          token: 'secret-new',
          base: 'https://api.example/v1',
        })
      },
    },
    fetch: (input, init) => {
      calls++
      let headers = new Headers(init?.headers)
      if (calls == 1) {
        assertEquals(input, 'https://chatgpt.example/codex/responses')
        assertEquals(headers.get('authorization'), 'Bearer secret-old')
        return Promise.resolve(
          new Response(
            '{"error":{"code":"expired","message":"secret-old acct-1"}}',
            { status: 401 },
          ),
        )
      }
      assertEquals(input, 'https://api.example/v1/responses')
      assertEquals(headers.get('authorization'), 'Bearer secret-new')
      assertEquals(headers.get('chatgpt-account-id'), null)
      return Promise.resolve(sse(
        {
          type: 'response.output_text.delta',
          delta: 'secret-old secret-new acct-1 safe',
        },
        {
          type: 'response.completed',
          response: { status: 'completed', model: 'served' },
        },
      ))
    },
  })
  let out = await client.run(
    { model: 'm', input: [] },
    { event: (event) => observed.push(event) },
  )
  assertEquals(calls, 2)
  assertEquals(refreshed, 1)
  assertEquals(JSON.stringify(out).includes('secret-'), false)
  assertEquals(JSON.stringify(out).includes('acct-'), false)
  assertEquals(JSON.stringify(observed).includes('secret-'), false)
  assertEquals(JSON.stringify(observed).includes('acct-'), false)
  assertEquals(
    responseObservation(observed[0]),
    { kind: 'model', text: '[redacted] [redacted] [redacted] safe' },
  )
})
