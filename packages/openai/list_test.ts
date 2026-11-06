import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { ModelError } from '@yaks/model'
import { listing } from './list.ts'
import { CODEX, OPENAI } from './credential.ts'

let cred = { token: 'private-token', base: 'https://provider.example/v1' }
let catalog = () => Response.json({ data: [{ id: 'model' }] })

test('model listing retries HTTP capacity errors at the fetch seam', async () => {
  for (let status of [408, 409, 429, 500, 502, 503, 504]) {
    let calls = 0
    let pauses: number[] = []
    let rejected: Response | undefined
    let models = await listing(
      cred,
      (input) => {
        assertEquals(String(input), cred.base + '/models')
        if (++calls > 1) return Promise.resolve(catalog())
        rejected = new Response('busy', {
          status,
          headers: { 'Retry-After': '2.5' },
        })
        return Promise.resolve(rejected)
      },
      undefined,
      {},
      {
        pause: (ms) => {
          // The error body is drained before this delay and another connection.
          assertEquals(rejected?.bodyUsed, true)
          pauses.push(ms)
          return Promise.resolve()
        },
      },
    )
    assertEquals(models, [{ name: 'model' }])
    assertEquals(calls, 2)
    assertEquals(pauses, [2500])
  }
})

test('model listing respects Retry-After dates and waits longer than the backoff cap', async () => {
  for (let value of [new Date(Date.now() + 120_000).toUTCString(), '120']) {
    let calls = 0
    let pauses: number[] = []
    await listing(
      cred,
      () =>
        Promise.resolve(
          ++calls == 1
            ? new Response('', {
              status: 429,
              headers: { 'Retry-After': value },
            })
            : catalog(),
        ),
      undefined,
      {},
      {
        pause: (ms) => {
          pauses.push(ms)
          return Promise.resolve()
        },
      },
    )
    assertEquals(pauses.length, 1)
    assertEquals(pauses[0] > 110_000 && pauses[0] <= 120_000, true)
  }
})

test('model listing backs off exponentially and leaves exhausted capacity retryable', async () => {
  let calls = 0
  let pauses: number[] = []
  let error = await assertRejects(
    () =>
      listing(
        cred,
        () => {
          calls++
          return Promise.resolve(
            new Response('private-token', {
              status: 503,
              headers: { 'Retry-After': 'bad-date' },
            }),
          )
        },
        undefined,
        {},
        {
          pause: (ms) => {
            pauses.push(ms)
            return Promise.resolve()
          },
        },
      ),
    ModelError,
    'Model listing says 503',
  )
  assertEquals([calls, pauses], [3, [1000, 4000]])
  assertEquals(error.retry, { after: 0 })
  assertEquals(error.message.includes(cred.token), false)
})

test('model listing does not retry permanent auth or spent quota failures', async () => {
  for (
    let [status, code] of [
      [401, undefined],
      [403, undefined],
      [400, 'invalid_request_error'],
      [429, 'insufficient_quota'],
      [429, 'usage_limit_reached'],
    ] as const
  ) {
    let calls = 0
    let error = await assertRejects(() =>
      listing(
        cred,
        () => {
          calls++
          return Promise.resolve(Response.json({ error: { code } }, { status }))
        },
        undefined,
        {},
        {
          pause: () => {
            throw new Error('permanent failures must not back off')
          },
        },
      ), ModelError)
    assertEquals(calls, 1)
    assertEquals(error.retry, undefined)
  }
})

test('model listing retries provider capacity codes even on a non-5xx response', async () => {
  let calls = 0
  let pauses: number[] = []
  assertEquals(
    await listing(
      cred,
      () =>
        Promise.resolve(
          ++calls == 1
            ? Response.json({ error: { code: 'server_is_overloaded' } }, {
              status: 400,
            })
            : catalog(),
        ),
      undefined,
      {},
      {
        pause: (ms) => {
          pauses.push(ms)
          return Promise.resolve()
        },
      },
    ),
    [{ name: 'model' }],
  )
  assertEquals(pauses, [1000])
})

test('model listing caps exponential backoff but preserves exhausted Retry-After', async () => {
  let pauses: number[] = []
  let calls = 0
  let error = await assertRejects(
    () =>
      listing(
        cred,
        () => {
          calls++
          return Promise.resolve(
            new Response('', {
              status: 429,
              headers: { 'Retry-After': '2' },
            }),
          )
        },
        undefined,
        {},
        {
          retries: 5,
          pause: (ms) => {
            pauses.push(ms)
            return Promise.resolve()
          },
        },
      ),
    ModelError,
    'Model listing says 429',
  )
  assertEquals(calls, 6)
  assertEquals(pauses, [2000, 4000, 16_000, 60_000, 60_000])
  assertEquals(error.retry, { after: 2000 })
})

test('Codex model catalog supplies client version and lists slugs', async () => {
  let seen: URL | undefined
  let names = await listing({
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
  let names = await listing({ token: 'key', base: OPENAI }, (input) => {
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
  let names = await listing({
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
      listing(
        { token: 'private-token', base: OPENAI },
        () => Promise.resolve(new Response('private-token', { status: 403 })),
      ),
    Error,
  )
  assertEquals(error.message.includes('private-token'), false)
})

test('model catalog retries a dropped connection and classifies an outage', async () => {
  for (let failures of [1, 3]) {
    let calls = 0
    let pauses: number[] = []
    let list = () =>
      listing(
        { token: 'private-token', base: OPENAI },
        () => {
          if (++calls <= failures) throw new TypeError('tls handshake eof')
          return Promise.resolve(Response.json({ data: [{ id: 'gpt-6-sol' }] }))
        },
        undefined,
        {},
        {
          pause: (ms) => {
            pauses.push(ms)
            return Promise.resolve()
          },
        },
      )
    if (failures == 1) {
      assertEquals(await list(), [{ name: 'gpt-6-sol' }])
    } else {
      let error = await assertRejects(list, ModelError, 'tls handshake eof')
      assertEquals([error.code, error.retry], ['transport', { after: 0 }])
    }
    assertEquals(calls, failures == 1 ? 2 : 3)
    assertEquals(pauses, failures == 1 ? [1000] : [1000, 4000])
  }
})
