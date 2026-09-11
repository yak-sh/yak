import { assertEquals, assertRejects } from '@std/assert'
import { responses } from './responses.ts'
import type { TextDelta } from '@yaks/model'
const packet = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n'
Deno.test('provider emits only public text and retains response item identities', async () => {
  const events = [
    { type: 'response.created' },
    { type: 'response.reasoning_summary_text.delta', delta: 'not exposed' },
    { type: 'response.function_call_arguments.delta', delta: '{' },
    { type: 'response.output_text.delta', item_id: 'm1', delta: 'hello' },
    {
      type: 'response.output_item.done',
      item: {
        id: 'm1',
        type: 'message',
        content: [{ type: 'output_text', text: 'hello' }],
      },
    },
    {
      type: 'response.completed',
      response: { id: 'r', model: 'fake', status: 'completed' },
    },
  ]
  const model = responses({
    credential: () => ({ token: 'private', base: 'https://example.invalid' }),
    fetch: () =>
      Promise.resolve(
        new Response(events.map(packet).join(''), {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
  })
  const deltas: TextDelta[] = []
  const reply = await model({
    model: 'fake',
    items: [],
    tools: [],
    onText: (d) => deltas.push(d),
  })
  assertEquals(deltas, [{ index: 0, id: 'm1', text: 'hello' }])
  assertEquals(reply.items, [{ kind: 'assistant', id: 'm1', text: 'hello' }])
})
Deno.test('a broken streamed exchange is not retried after public text was exposed', async () => {
  let calls = 0
  const model = responses({
    credential: () => ({ token: 'private', base: 'https://example.invalid' }),
    fetch: () => {
      calls++
      return Promise.resolve(
        new Response(
          packet({
            type: 'response.output_text.delta',
            item_id: 'm',
            delta: 'partial',
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    },
  })
  await assertRejects(() =>
    model({ model: 'fake', items: [], tools: [], onText: () => {} })
  )
  assertEquals(calls, 1)
})
