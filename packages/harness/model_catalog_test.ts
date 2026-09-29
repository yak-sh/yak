// The model command reads each provider's catalog through its public shape.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { CODEX, OPENAI } from '@yaks/openai'
import { modelCatalog } from './runs.ts'

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
      models: [{ slug: 'gpt-6-astra' }, { slug: 'gpt-6-sol' }],
    }))
  })
  assertEquals(seen?.pathname, '/backend-api/codex/models')
  assertEquals(names, ['gpt-6-astra', 'gpt-6-sol'])
})

test('OpenAI model catalog lists ids without Codex query', async () => {
  let names = await modelCatalog({ token: 'key', base: OPENAI }, (input) => {
    let url = new URL(String(input))
    assertEquals(url.pathname, '/v1/models')
    assertEquals(url.search, '')
    return Promise.resolve(Response.json({ data: [{ id: 'gpt-4.1' }] }))
  })
  assertEquals(names, ['gpt-4.1'])
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
  assertEquals(names, ['gpt-6-astra'])
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
