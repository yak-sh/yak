// The Responses model at its seams, no network: the body a request becomes,
// the items a stream becomes, how a refusal and a dead stream read, and where
// a credential comes from.

import { assertEquals, assertRejects } from '@std/assert'
import { ModelError, type Request } from '@yaks/model'
import { body, fromCodex, fromEnv, items, responses } from './mod.ts'
import { codexPaths, credential } from './credential.ts'

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
}

Deno.test('a request is spelled the way the API wants', () => {
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
    [b.reasoning, b.previous_response_id, b.store, b.stream, b.instructions],
    [{ effort: 'low' }, 'r0', true, true, 'be terse'],
  )
  assertEquals(
    body({ ...req, anchor: undefined }).previous_response_id,
    undefined,
  )
  assertEquals(body(req).store, false)
})

Deno.test('completed items come back neutral; reasoning is dropped', () => {
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

Deno.test('a streamed reply is read to its end', async () => {
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
      { type: 'response.completed', response: { id: 'r1', model: 'm-2' } },
    ),
  )
  let model = responses({ credential: () => codex, fetch: fetcher })
  let reply = await model(req)
  assertEquals(reply, {
    id: 'r1',
    model: 'm-2',
    items: [{ kind: 'assistant', text: 'done' }],
  })
  assertEquals(asked[0].url, 'https://x.test/codex/responses')
  assertEquals(asked[0].headers.get('authorization'), 'Bearer t')
  assertEquals(asked[0].headers.get('chatgpt-account-id'), 'acct')
  assertEquals((asked[0].body as { store: boolean }).store, false)
})

Deno.test('a refusal, a failed stream and no credential are errors', async () => {
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
    () => responses({ credential: () => codex, fetch: dead.fetcher })(req),
    ModelError,
  )
  assertEquals(e.code, 'failed')

  e = await assertRejects(
    () =>
      responses({
        credential: () => Promise.reject(new Error('nobody home')),
        fetch: dead.fetcher,
      })(req),
    ModelError,
    'nobody home',
  )
  assertEquals(e.code, 'no_credential')
})

Deno.test('a credential comes from the environment or a Codex auth.json', async () => {
  let env = (vars: Record<string, string>) => (n: string) => vars[n]
  assertEquals(fromEnv(env({ OPENAI_API_KEY: 'k' })), {
    token: 'k',
    base: 'https://api.openai.com/v1',
  })
  assertEquals(fromEnv(env({})), undefined)
  assertEquals(
    fromCodex(JSON.stringify({
      tokens: { access_token: 'a', account_id: 'acct', refresh_token: 'r' },
    })),
    {
      token: 'a',
      account: 'acct',
      base: 'https://chatgpt.com/backend-api/codex',
    },
  )
  assertEquals(fromCodex(JSON.stringify({ OPENAI_API_KEY: 'k' }))?.token, 'k')
  assertEquals(fromCodex('{}'), undefined)
  assertEquals(fromCodex('not json'), undefined)
  assertEquals(codexPaths(env({ HOME: '/h', CODEX_HOME: '/c' })), [
    '/c/auth.json',
    '/h/.local/state/tasks/codex/auth.json',
    '/h/.codex/auth.json',
  ])

  // the environment wins; then the first file that opens and holds one
  let files: Record<string, string> = {
    '/h/.codex/auth.json': JSON.stringify({
      tokens: { access_token: 'a', account_id: 'acct' },
    }),
  }
  let read = (p: string) =>
    p in files ? Promise.resolve(files[p]) : Promise.reject(new Error('ENOENT'))
  assertEquals((await credential(env({ HOME: '/h' }), read)()).token, 'a')
  assertEquals(
    (await credential(env({ HOME: '/h', OPENAI_API_KEY: 'k' }), read)()).token,
    'k',
  )
  await assertRejects(() => credential(env({}), read)(), Error, 'no credential')
})
