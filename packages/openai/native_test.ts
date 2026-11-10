// The door takes a chat request in the dialect OpenAI-compatible servers
// share, asks OpenAI for it as Chat Completions takes it, answers in both
// shapes, and pays for nothing OpenAI refused.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Lent, ModelError, type Spending } from '@yaks/model'
import { answer, native, request } from './native.ts'

test('a dialect request is asked of OpenAI as Chat Completions takes it', () => {
  let schema = { type: 'object' }
  let weather = { name: 'weather', parameters: schema }
  let cases: [Record<string, unknown>, Record<string, unknown>][] = [
    [{ prompt: 'hi', max_tokens: 9, temperature: 0, top_p: 1 }, {
      messages: [{ role: 'user', content: 'hi' }],
    }],
    [{
      messages: [],
      tools: [weather],
      response_format: { type: 'json_schema', json_schema: schema },
      chat_template_kwargs: { enable_thinking: true },
    }, {
      messages: [],
      tools: [{ type: 'function', function: weather }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', schema },
      },
      reasoning_effort: 'low',
    }],
    [{ messages: [], reasoning_effort: 'high', stream: true }, {
      messages: [],
      reasoning_effort: 'high',
    }],
  ]
  for (let [sent, asked] of cases) {
    assertEquals(request(sent, 'gpt-6-luna', 9), {
      model: 'gpt-6-luna',
      reasoning_effort: 'none',
      ...asked,
      max_completion_tokens: 9,
    })
  }
  assertEquals(
    request({ messages: [] }, 'm', 1, 'conv').prompt_cache_key,
    'conv',
  )
})

test('an answer carries the text and calls as the dialect reads them', () => {
  let call = {
    id: 'c',
    function: { name: 'weather', arguments: '{"city":"Paris"}' },
  }
  let out = { choices: [{ message: { content: null, tool_calls: [call] } }] }
  assertEquals(answer(out), {
    ...out,
    response: '',
    tool_calls: [{ name: 'weather', arguments: { city: 'Paris' } }],
  })
})

// The door over a fake OpenAI answering `status` and `body`, and what the
// spending it is held to settled at.
let door = (status: number, body: unknown) => {
  let settled: number[] = []
  let lent = {
    fetch: (input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).endsWith('.md')
          ? new Response('- 1,050,000 context window')
          : Response.json(body, { status }),
      ),
    env: () => undefined,
  } as unknown as Lent
  let spending: Spending = {
    hold: (quote) =>
      Promise.resolve({
        value: quote(1)!,
        settle: (dollars) => Promise.resolve(settled.push(dollars)),
      }),
  }
  let it = native(lent, { aliases: { asked: 'gpt-6-luna' } }, spending)
  return {
    settled,
    serves: it.serves!,
    run: (model: string) =>
      it.run(model, {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10,
      }),
  }
}

test('the door answers only its aliases and pays for what was used', async () => {
  let d = door(200, {
    choices: [{ message: { content: 'Hi.' } }],
    usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
  })
  assertEquals([d.serves('asked'), d.serves('@cf/other')], [true, false])
  assertEquals((await d.run('asked') as { response: string }).response, 'Hi.')
  assertEquals(d.settled, [0.125])
})

test('what OpenAI refuses is heard as whose it is, and costs nothing', async () => {
  for (
    let [status, code, heard] of [
      [400, 'invalid_value', 'bad_request'],
      [404, 'model_not_found', 'model'],
      [429, 'insufficient_quota', 'limit'],
      [429, 'rate_limit_exceeded', 'busy'],
    ] as const
  ) {
    let d = door(status, { error: { code, message: 'no' } })
    let e = await assertRejects(() => d.run('asked'), ModelError)
    assertEquals([e.code, d.settled], [heard, [0]])
  }
})
