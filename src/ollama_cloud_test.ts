// Ollama's hosted transport and readiness probe over the runtime config catalog:
// the base resolves graph > environment > default and is read fresh per request,
// the key comes from the server-only credential plane and never enters the graph
// or the request body. Uses an in-memory graph so a save changes the next
// request without a restart.
Deno.env.set('DB_PATH', ':memory:')
let { apply, settingValue, snapshot } = await import('./db.ts')
let { resolve } = await import('./config.ts')
let { ollamaCloudTransport, ollamaProbe } = await import('./ollama_cloud.ts')
let { assertEquals, assertRejects } = await import('@std/assert')
let { bareDb } = await import('./testdb.ts')

let complete = () =>
  new Response(
    [
      { type: 'response.created', response: { status: 'in_progress' } },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          model: 'kimi-k2.7-code',
          output: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )

// A transport wired to a fixed config, capturing the last request it made.
let probeTransport = (config: {
  base: () => string
  key: () => Promise<string | undefined>
}) => {
  let seen: { url: string; init?: RequestInit } = { url: '' }
  let client = ollamaCloudTransport({
    fetch: (url, init) => {
      seen.url = String(url)
      seen.init = init
      return Promise.resolve(complete())
    },
  }, config)
  return { client, seen }
}

Deno.test('ollama cloud defaults to the keyless yak proxy', async () => {
  let { client, seen } = probeTransport({
    base: () => 'https://ollama.yak.sh/',
    key: () => Promise.resolve(undefined),
  })
  let result = await client.run({
    model: 'kimi-k2.7-code',
    input: 'hello',
    instructions: 'use tools',
    tools: [{ type: 'function', name: 'graph_query' }],
  })

  assertEquals(seen.url, 'https://ollama.yak.sh/v1/responses')
  assertEquals(new Headers(seen.init?.headers).has('authorization'), false)
  let body = JSON.parse(String(seen.init?.body))
  assertEquals(body.model, 'kimi-k2.7-code')
  assertEquals(body.stream, true)
  assertEquals(body.instructions, 'use tools')
  assertEquals(body.tools, [{ type: 'function', name: 'graph_query' }])
  assertEquals('include' in body, false)
  assertEquals('store' in body, false)
  assertEquals(result.model, 'kimi-k2.7-code')
})

Deno.test('ollama cloud supports a configured base and optional API key', async () => {
  let { client, seen } = probeTransport({
    base: () => 'https://ollama.com/',
    key: () => Promise.resolve('cloud-secret'),
  })
  await client.run({ model: 'kimi-k2.7-code', input: 'hello' })

  assertEquals(seen.url, 'https://ollama.com/v1/responses')
  assertEquals(
    new Headers(seen.init?.headers).get('authorization'),
    'Bearer cloud-secret',
  )
  // The key rides only in the header — never the body.
  assertEquals(String(seen.init?.body).includes('cloud-secret'), false)
})

Deno.test('a base already ending in /v1 is used as-is', async () => {
  let { client, seen } = probeTransport({
    base: () => 'https://host.example/v1',
    key: () => Promise.resolve(undefined),
  })
  await client.run({ model: 'kimi-k2.7-code', input: 'hello' })
  assertEquals(seen.url, 'https://host.example/v1/responses')
})

Deno.test('a saved base override reaches the next request without a restart', async () => {
  let db = bareDb()
  // The server's own resolver: graph override (live from the setting table) >
  // environment > default. One transport instance, built once.
  let config = {
    base: () =>
      resolve('OLLAMA_BASE_URL', (key) => settingValue(db, key)).value!,
    key: () => Promise.resolve(undefined),
  }
  let { client, seen } = probeTransport(config)

  // No override yet: the catalog default answers.
  await client.run({ model: 'kimi-k2.7-code', input: 'hi' })
  assertEquals(seen.url, 'https://ollama.yak.sh/v1/responses')

  // Save an override; the SAME transport picks it up on the next request.
  apply(db, [{
    eid: crypto.randomUUID(),
    name: 'setting',
    comp: { key: 'OLLAMA_BASE_URL', value: 'https://saved.example/' },
  }])
  await client.run({ model: 'kimi-k2.7-code', input: 'hi' })
  assertEquals(seen.url, 'https://saved.example/v1/responses')
})

Deno.test('the environment answers when the graph holds no override', () => {
  // Fallback order lives in resolve(); assert the transport's plane wiring uses
  // it — graph empty, environment supplies the base.
  let r = resolve(
    'OLLAMA_BASE_URL',
    () => undefined,
    (key) => ({ OLLAMA_BASE_URL: 'https://from-env.example' })[key],
  )
  assertEquals(r.value, 'https://from-env.example')
  assertEquals(r.source, 'environment')
})

Deno.test('the API key never enters the graph or a request body', async () => {
  let db = bareDb()
  // The key plane is the credential store, not the graph — a setting write of
  // the secret key is refused, so nothing about it can ride the snapshot.
  let refused = false
  try {
    apply(db, [{
      eid: crypto.randomUUID(),
      name: 'setting',
      comp: { key: 'OLLAMA_API_KEY', value: 'sk-secret' },
    }])
  } catch {
    refused = true
  }
  assertEquals(refused, true)
  assertEquals(JSON.stringify(snapshot(db)).includes('sk-secret'), false)

  // And when a key IS supplied (via the server-only plane), it reaches only the
  // authorization header, never the serialized request.
  let { client, seen } = probeTransport({
    base: () => 'https://ollama.yak.sh/',
    key: () => Promise.resolve('sk-secret'),
  })
  await client.run({ model: 'kimi-k2.7-code', input: 'hi' })
  assertEquals(String(seen.init?.body).includes('sk-secret'), false)
  assertEquals(
    new Headers(seen.init?.headers).get('authorization'),
    'Bearer sk-secret',
  )
})

Deno.test('the readiness probe hits the resolved base with the supplied secret', async () => {
  let seen: { url: string; auth: string | null } = { url: '', auth: null }
  let probe = ollamaProbe(
    () => 'https://saved.example/',
    (url, init) => {
      seen.url = String(url)
      seen.auth = new Headers(init?.headers).get('authorization')
      return Promise.resolve(new Response('{}', { status: 200 }))
    },
  )
  await probe('OLLAMA_API_KEY', 'cloud-secret')
  assertEquals(seen.url, 'https://saved.example/v1/models')
  assertEquals(seen.auth, 'Bearer cloud-secret')
})

Deno.test('the readiness probe throws on a non-2xx so test reports it', async () => {
  let probe = ollamaProbe(
    () => 'https://saved.example/',
    () => Promise.resolve(new Response('nope', { status: 401 })),
  )
  await assertRejects(() => probe('OLLAMA_API_KEY', 'bad-key'))
})
