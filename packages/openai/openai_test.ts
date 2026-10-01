// The Responses model at its seams, no network: the body a request becomes,
// the items a stream becomes, how a refusal and a dead stream read, and where
// a credential comes from.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { ModelError, type Request } from '@yaks/model'
import { body, CODEX, fromChatGPT, fromEnv, items, responses } from './mod.ts'

let req: Request = {
  model: 'm',
  effort: 'low',
  instructions: 'be terse',
  items: [
    { kind: 'user', text: 'hi' },
    { kind: 'assistant', text: 'hello' },
    { kind: 'call', id: 'c1', name: 'echo', args: '{"a":1}' },
    { kind: 'result', id: 'c1', output: 'ok' },
  ],
  tools: [{ name: 'echo', description: 'd', parameters: { type: 'object' } }],
  anchor: 'r0',
  tokens: 64,
}

test('a request is shaped the way the API wants', () => {
  let b = body(req, true)
  assertEquals(b.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'hello' }],
    },
    {
      type: 'function_call',
      call_id: 'c1',
      name: 'echo',
      arguments: '{"a":1}',
    },
    { type: 'function_call_output', call_id: 'c1', output: 'ok' },
  ])
  assertEquals(b.tools, [{
    type: 'function',
    strict: false,
    name: 'echo',
    description: 'd',
    parameters: { type: 'object' },
  }])
  assertEquals(
    [
      b.reasoning,
      b.previous_response_id,
      b.store,
      b.stream,
      b.instructions,
      b.max_output_tokens,
    ],
    [{ effort: 'low' }, 'r0', true, true, 'be terse', 64],
  )
  assertEquals(
    body({ ...req, anchor: undefined }).previous_response_id,
    undefined,
  )
  assertEquals(body(req).store, false)
})

test('completed items come back neutral; reasoning is dropped', () => {
  assertEquals(
    items([
      { type: 'reasoning', summary: [] },
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'a' }, {
          type: 'output_text',
          text: 'b',
        }],
      },
      { type: 'function_call', call_id: 'c', name: 'echo', arguments: '{}' },
    ]),
    [
      { kind: 'assistant', text: 'ab' },
      { kind: 'call', id: 'c', name: 'echo', args: '{}' },
    ],
  )
})

let sse = (...events: unknown[]) =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')

let serving = (status: number, text: string) => {
  let asked: { url: string; headers: Headers; body: unknown }[] = []
  let fetcher = (url: string | URL | Request, init?: RequestInit) => {
    asked.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    })
    return Promise.resolve(
      new Response(text, {
        status,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
  }
  return { asked, fetcher: fetcher as typeof fetch }
}

let codex = { token: 't', account: 'acct', base: 'https://x.test/codex' }

test('a compaction request succeeds on the Codex endpoint', async () => {
  let asked: Record<string, unknown>[] = []
  let model = responses({
    credential: () => ({ ...codex, base: CODEX }),
    fetch: (_url, init) => {
      let body = JSON.parse(String(init?.body))
      asked.push(body)
      return Promise.resolve(
        'max_output_tokens' in body
          ? new Response(
            JSON.stringify({
              detail: 'Unsupported parameter: max_output_tokens',
            }),
            { status: 400 },
          )
          : new Response(sse({
            type: 'response.completed',
            response: { id: 'summary', model: 'm', status: 'completed' },
          })),
      )
    },
  })
  let reply = await model({
    model: 'm',
    items: [{ kind: 'user', text: 'Summarize this transcript.' }],
    tools: [],
    tokens: 4096,
  })
  assertEquals(reply.id, 'summary')
  assertEquals(asked.length, 1)
})

test('a streamed reply is read to its end', async () => {
  let { asked, fetcher } = serving(
    200,
    sse(
      { type: 'response.created' },
      { type: 'response.output_text.delta', delta: 'do' },
      {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          content: [{ type: 'output_text', text: 'done' }],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'r1',
          model: 'm-2',
          status: 'completed',
          usage: {
            input_tokens: 1000,
            output_tokens: 20,
            total_tokens: 1020,
            input_tokens_details: { cached_tokens: 800 },
            output_tokens_details: { reasoning_tokens: 10 },
          },
        },
      },
    ),
  )
  let model = responses({ credential: () => codex, fetch: fetcher })
  let reply = await model(req)
  assertEquals(reply, {
    id: 'r1',
    model: 'm-2',
    items: [{ kind: 'assistant', text: 'done' }],
    usage: {
      input_tokens: 1000,
      output_tokens: 20,
      total_tokens: 1020,
      cached_tokens: 800,
      reasoning_tokens: 10,
    },
  })
  assertEquals(asked[0].url, 'https://x.test/codex/responses')
  assertEquals(asked[0].headers.get('authorization'), 'Bearer t')
  assertEquals(asked[0].headers.get('chatgpt-account-id'), 'acct')
  assertEquals((asked[0].body as { store: boolean }).store, false)
})

test('a refusal, a failed stream and no credential are errors', async () => {
  let refused = serving(
    400,
    JSON.stringify({
      error: { code: 'previous_response_not_found', message: 'gone' },
    }),
  )
  let e = await assertRejects(
    () => responses({ credential: () => codex, fetch: refused.fetcher })(req),
    ModelError,
    'HTTP 400 — gone',
  )
  assertEquals(e.code, 'previous_response_not_found')

  let dead = serving(200, sse({ type: 'response.failed', response: {} }))
  e = await assertRejects(
    () =>
      responses({
        credential: () => codex,
        fetch: dead.fetcher,
        pause: () => Promise.resolve(),
      })(req),
    ModelError,
  )
  assertEquals([e.code, e.retry], ['failed', { after: 0 }])

  e = await assertRejects(
    () =>
      responses({
        credential: () => Promise.reject(new Error('nobody home')),
        fetch: dead.fetcher,
        pause: () => Promise.resolve(),
      })(req),
    ModelError,
    'nobody home',
  )
  assertEquals(e.code, 'no_credential')

  let idle = serving(200, '')
  let questions = { plan: { type: 'noul' as const, instructions: '?' } }
  e = await assertRejects(
    () =>
      responses({ credential: () => codex, fetch: idle.fetcher })({
        ...req,
        questions,
      }),
    ModelError,
  )
  assertEquals([e.code, idle.asked], ['questions', []])
})

test('an API key and a ChatGPT bearer identify their own endpoint', () => {
  let env = (vars: Record<string, string>) => (n: string) => vars[n]
  assertEquals(fromEnv(env({ OPENAI_API_KEY: 'k' })), {
    token: 'k',
    base: 'https://api.openai.com/v1',
  })
  assertEquals(fromEnv(env({})), undefined)
  let token = 'header.' + btoa(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct' },
  })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') + '.sig'
  assertEquals(fromChatGPT(token), {
    token,
    account: 'acct',
    base: 'https://chatgpt.com/backend-api/codex',
  })
  assertThrows(() => fromChatGPT('bad.token'), Error, 'no account')
})

test('the Model shares refresh, redacted frame hooks, store, and anchor policy', async () => {
  let attempts = 0
  let seen: unknown[] = []
  let model = responses({
    credential: () => ({ ...codex, token: 'old-key' }),
    refresh: () => ({ ...codex, token: 'new-key' }),
    store: true,
    redact: true,
    event: (frame) => seen.push(frame.delta),
    fetch: (_url, init) => {
      assertEquals(JSON.parse(String(init?.body)).store, true)
      if (++attempts == 1) {
        return Promise.resolve(new Response('', { status: 401 }))
      }
      assertEquals(
        new Headers(init?.headers).get('authorization'),
        'Bearer new-key',
      )
      return Promise.resolve(
        new Response(sse(
          { type: 'response.output_text.delta', delta: 'new-key' },
          {
            type: 'response.completed',
            response: { id: 'r1', model: 'm', status: 'completed' },
          },
        )),
      )
    },
  })
  let reply = await model(req)
  assertEquals(seen[0], '[redacted]')
  assertEquals(model.mark!(reply), { openai: { response_id: 'r1' } })
  assertEquals(model.anchor!(model.mark!(reply)), 'r1')
  assertEquals(
    responses({ credential: () => codex }).anchor!(model.mark!(reply)),
    undefined,
  )
})

test('the Model maps the shared watchdog to ModelError', async () => {
  let model = responses({
    credential: () => codex,
    stallMs: 20,
    retries: 0,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')))
      }),
  })
  let error = await assertRejects(
    () => model(req),
    ModelError,
    'transport stalled',
  )
  assertEquals(error.code, 'stalled')
})

test('usage keeps missing counts unknown and rejects invalid counts', async () => {
  let { tokenUsage } = await import('./responses.ts')
  assertEquals(tokenUsage(undefined), {})
  assertEquals(tokenUsage({}), {})
  assertEquals(tokenUsage({ input_tokens: 42 }), {
    usage: { input_tokens: 42 },
  })
  assertEquals(
    tokenUsage({
      input_tokens: -1,
      output_tokens: 1.5,
      total_tokens: '3',
      input_tokens_details: { cached_tokens: 0 },
    }),
    { usage: { cached_tokens: 0 } },
  )
})
