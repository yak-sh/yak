// The model command reads each provider's catalog through its public shape.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { CODEX, OPENAI } from '@yaks/openai'
import { graph, identityEid } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { modelDoc } from '@yaks/model'
import { modelCatalog, windows } from './runs.ts'

test('Codex model catalog supplies client version and lists slugs', async () => {
  let seen: URL | undefined
  let names = await modelCatalog({
    token: 'secret',
    account: 'account',
    base: CODEX,
  }, (input, init) => {
    seen = new URL(String(input))
    assertEquals(seen.searchParams.has('client_version'), true)
    let headers = new Headers(init?.headers)
    assertEquals(headers.get('authorization'), 'Bearer secret')
    assertEquals(headers.get('chatgpt-account-id'), 'account')
    return Promise.resolve(Response.json({
      models: [
        { slug: 'gpt-6-astra', context_window: 272_000 },
        { slug: 'gpt-6-sol' },
      ],
    }))
  })
  assertEquals(seen?.pathname, '/backend-api/codex/models')
  assertEquals(names, [
    { name: 'gpt-6-astra', context: 272_000 },
    { name: 'gpt-6-sol' },
  ])
})

test('OpenAI model catalog lists ids without Codex query', async () => {
  let names = await modelCatalog({ token: 'key', base: OPENAI }, (input) => {
    let url = new URL(String(input))
    assertEquals(url.pathname, '/v1/models')
    assertEquals(url.search, '')
    return Promise.resolve(
      Response.json({
        data: [{ id: 'gpt-4.1' }, { id: 'or/m', context_length: 128_000 }],
      }),
    )
  })
  assertEquals(names, [{ name: 'gpt-4.1' }, { name: 'or/m', context: 128_000 }])
})

test('Codex model catalog refreshes a rejected connection once', async () => {
  let tokens: string[] = []
  let refreshed = 0
  let names = await modelCatalog({
    token: 'stale',
    account: 'account',
    base: CODEX,
  }, (_input, init) => {
    let token = new Headers(init?.headers).get('authorization')!
    tokens.push(token)
    return Promise.resolve(
      token == 'Bearer stale'
        ? new Response('expired', { status: 401 })
        : Response.json({ models: [{ slug: 'gpt-6-astra' }] }),
    )
  }, () => {
    refreshed++
    return Promise.resolve({
      token: 'fresh',
      account: 'account',
      base: CODEX,
    })
  })
  assertEquals(names, [{ name: 'gpt-6-astra' }])
  assertEquals(tokens, ['Bearer stale', 'Bearer fresh'])
  assertEquals(refreshed, 1)
})

test('model catalog errors do not repeat a credential', async () => {
  let error = await assertRejects(
    () =>
      modelCatalog(
        { token: 'private-token', base: OPENAI },
        () => Promise.resolve(new Response('private-token', { status: 403 })),
      ),
    Error,
  )
  assertEquals(error.message.includes('private-token'), false)
})

test('a catalog gives a model row its window, unless the row has its own', async () => {
  let vocab = loadVocab([modelDoc])
  let g = graph({ storage: ram(vocab), vocab })
  let row = (name: string, context?: number) => ({
    entity: { eid: identityEid('model', [name]) },
    model: { name, ...context ? { context } : {} },
  })
  await g.apply([row('gpt-6.1-sol', 1_000_000), row('gpt-6-astra')])
  let listed = await windows(g, [
    { name: 'gpt-6.1-sol', context: 272_000 },
    { name: 'gpt-6-astra', context: 272_000 },
    { name: 'unseen', context: 64_000 },
  ])
  assertEquals(listed.map((m) => m.context), [1_000_000, 272_000, 64_000])
  let rows = await g.get(listed.map((m) => identityEid('model', [m.name])))
  assertEquals(rows.map((b) => (b.model as { context?: number }).context), [
    1_000_000,
    272_000,
  ])
})
