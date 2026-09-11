import { assert, assertEquals, assertRejects } from '@std/assert'
import { ModelError } from '@yaks/model'
import { ResponseError, responses, transport } from './mod.ts'

let sse = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''))
let item = (text: string) => ({
  type: 'response.output_item.done',
  item: { type: 'message', content: [{ type: 'output_text', text }] },
})
let complete = () =>
  sse(item('done'), {
    type: 'response.completed',
    response: { id: 'r', model: 'm', status: 'completed' },
  })
let broken = () =>
  new Response(
    new ReadableStream({
      start(c) {
        c.error(new TypeError('error reading a body from connection'))
      },
    }),
  )
// The shape a busy backend actually sends: a 200 stream ending in
// response.failed, the capacity code inside the response's error object.
let overloaded = () =>
  sse({
    type: 'response.failed',
    response: {
      error: { code: 'server_is_overloaded', message: 'the server is busy' },
    },
  })
let credentials = {
  get: () => ({ token: 'fake', base: 'https://fake.test/v1' }),
}
let req = { model: 'm', input: [] }

Deno.test('transient failures replay the same request and keep only successful items', async () => {
  for (
    let [index, failure] of [
      () => {
        throw Object.assign(new Error('reset'), { code: 'ECONNRESET' })
      },
      broken,
      () => sse(item('discard this attempt')),
      () => new Response(null, { status: 200 }),
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 429, headers: { 'retry-after': '2' } }),
    ].entries()
  ) {
    let calls: RequestInit[] = []
    let pauses: number[] = []
    let shapes = 0
    let client = transport({
      credentials,
      shape: (r) => {
        shapes++
        return r
      },
      pause: (ms) => {
        pauses.push(ms)
        return Promise.resolve()
      },
      fetch: (_url, init) => {
        calls.push(init!)
        return Promise.resolve(calls.length == 1 ? failure() : complete())
      },
    })
    let out = await client.run(req)
    assertEquals(calls.length, 2)
    assertEquals(shapes, 1)
    assertEquals(calls[0].body, calls[1].body)
    assertEquals(new Headers(calls[0].headers), new Headers(calls[1].headers))
    assertEquals(out.items, [item('done').item])
    assertEquals(pauses.length, 1)
    assertEquals(pauses[0], index == 5 ? 2000 : 1000)
  }
})

Deno.test('three body-read failures become one ModelError, or a retry succeeds quietly', async () => {
  for (let failures of [1, 3]) {
    let calls = 0
    let pauses: number[] = []
    let model = responses({
      credential: credentials.get,
      pause: (ms) => {
        pauses.push(ms)
        return Promise.resolve()
      },
      fetch: () => Promise.resolve(++calls <= failures ? broken() : complete()),
    })
    let ask = () => model({ model: 'm', items: [], tools: [] })
    if (failures == 1) {
      assertEquals((await ask()).items, [{ kind: 'assistant', text: 'done' }])
    } else {
      let error = await assertRejects(ask, ModelError, 'error reading a body')
      assertEquals(error.code, 'transport')
    }
    assertEquals(calls, failures == 1 ? 2 : 3)
    assertEquals(pauses, failures == 1 ? [1000] : [1000, 4000])
  }
})

Deno.test('a capacity code is transient however it arrives, whatever the status', async () => {
  for (
    let [failure, wait] of [
      [overloaded, 1000],
      [
        () => sse({ type: 'error', code: 'overloaded_error', message: 'busy' }),
        1000,
      ],
      // A body naming its class in `type` with a null `code`, over a 4xx.
      [() =>
        new Response(JSON.stringify({ error: { type: 'server_error' } }), {
          status: 400,
        }), 1000],
      [
        () =>
          new Response(
            JSON.stringify({ error: { code: 'rate_limit_exceeded' } }),
            {
              status: 400,
              headers: { 'retry-after': '3' },
            },
          ),
        3000,
      ],
    ] as const
  ) {
    let calls = 0
    let pauses: number[] = []
    let client = transport({
      credentials,
      pause: (ms) => {
        pauses.push(ms)
        return Promise.resolve()
      },
      fetch: () => Promise.resolve(++calls == 1 ? failure() : complete()),
    })
    assertEquals((await client.run(req)).items, [item('done').item])
    assertEquals(calls, 2)
    assertEquals(pauses, [wait])
  }
})

Deno.test('an overloaded backend recovers with no error, or exhausts into exactly one', async () => {
  for (let mode of ['recover', 'exhaust', 'unauthorized'] as const) {
    let calls = 0
    let pauses: number[] = []
    let model = responses({
      credential: credentials.get,
      pause: (ms) => {
        pauses.push(ms)
        return Promise.resolve()
      },
      fetch: () => {
        calls++
        if (mode == 'unauthorized') {
          return Promise.resolve(new Response('', { status: 401 }))
        }
        return Promise.resolve(
          mode == 'exhaust' || calls == 1 ? overloaded() : complete(),
        )
      },
    })
    let ask = () => model({ model: 'm', items: [], tools: [] })
    if (mode == 'recover') {
      assertEquals((await ask()).items, [{ kind: 'assistant', text: 'done' }])
    } else await assertRejects(ask, ModelError)
    assertEquals(calls, mode == 'recover' ? 2 : mode == 'exhaust' ? 3 : 1)
    assertEquals(
      pauses,
      mode == 'recover' ? [1000] : mode == 'exhaust' ? [1000, 4000] : [],
    )
  }
})

Deno.test('HTTP auth and validation, malformed SSE, provider failures and hook defects fail fast', async () => {
  for (
    let response of [
      () => new Response('', { status: 401 }),
      () => new Response(broken().body, { status: 401 }),
      () => new Response('', { status: 400 }),
      () => new Response('data: {bad}\n\n'),
      () => sse({ type: 'response.failed' }),
      () => sse({ type: 'response.incomplete' }),
    ]
  ) {
    let calls = 0
    let client = transport({
      credentials,
      pause: () => {
        throw new Error('must not retry')
      },
      fetch: () => {
        calls++
        return Promise.resolve(response())
      },
    })
    await assertRejects(() => client.run(req), ResponseError)
    assertEquals(calls, 1)
  }
  let client = transport({
    credentials,
    fetch: () => Promise.resolve(complete()),
  })
  await assertRejects(
    () =>
      client.run(req, {
        event: () => {
          throw new Error('hook defect')
        },
      }),
    Error,
    'hook defect',
  )
})

Deno.test('Retry-After accepts seconds and HTTP dates and caps large waits', async () => {
  for (
    let [header, expected] of [['2', 2000], ['999999', 60_000], [
      'invalid',
      1000,
    ], ['0', 1000]] as const
  ) {
    let waits: number[] = []
    let client = transport({
      credentials,
      pause: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
      fetch: () =>
        Promise.resolve(
          new Response('', { status: 429, headers: { 'retry-after': header } }),
        ),
    })
    await assertRejects(() => client.run(req))
    assertEquals(waits, [expected, Math.max(expected, 4000)])
  }
  let waits: number[] = []
  let client = transport({
    credentials,
    retries: 1,
    pause: (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
    fetch: () =>
      Promise.resolve(
        new Response('', {
          status: 429,
          headers: {
            'retry-after': new Date(Date.now() + 30_000).toUTCString(),
          },
        }),
      ),
  })
  await assertRejects(() => client.run(req))
  assertEquals(waits[0] > 28_000 && waits[0] <= 30_000, true)
})

Deno.test('stop during backoff cancels the wait and prevents another attempt', async () => {
  let stop = new AbortController()
  let calls = 0
  let client = transport({
    credentials,
    pause: () => {
      stop.abort()
      return new Promise(() => {})
    },
    fetch: () => {
      calls++
      return Promise.resolve(broken())
    },
  })
  await assertRejects(
    () => client.run(req, { signal: stop.signal }),
    DOMException,
  )
  assertEquals(calls, 1)
})

// A bus that connects and goes silent, or never answers at all: the watchdog
// aborts the attempt, and the next one is as clean as a dropped connection.
let silent = (init?: RequestInit) =>
  new Promise<Response>((_ok, no) =>
    init?.signal?.addEventListener(
      'abort',
      () => no(new DOMException('aborted', 'AbortError')),
    )
  )

Deno.test('a stall is transient: the attempt after it completes the turn', async () => {
  let calls = 0
  let pauses: number[] = []
  let client = transport({
    credentials,
    stallMs: 20,
    pause: (ms) => {
      pauses.push(ms)
      return Promise.resolve()
    },
    fetch: (_url, init) =>
      ++calls == 1 ? silent(init) : Promise.resolve(complete()),
  })
  assertEquals((await client.run(req)).items, [item('done').item])
  assertEquals(calls, 2)
  assertEquals(pauses, [1000])
})

// The incident of 2026-09-10 (T-37332): every attempt answered 503 inside five
// seconds, and the Session settled `failed` over a blip.
Deno.test('an outage is waited out while patience remains, then gives up', async () => {
  for (let outage of [8, Infinity]) {
    let calls = 0
    let pauses: number[] = []
    let client = transport({
      credentials,
      patienceMs: 600_000,
      pause: (ms) => {
        pauses.push(ms)
        return Promise.resolve()
      },
      fetch: () =>
        Promise.resolve(
          ++calls <= outage ? new Response('', { status: 503 }) : complete(),
        ),
    })
    if (outage == 8) {
      assertEquals((await client.run(req)).items, [item('done').item])
      assertEquals(calls, 9)
      assertEquals(pauses, [
        1000,
        4000,
        16_000,
        60_000,
        60_000,
        60_000,
        60_000,
        60_000,
      ])
    } else {
      await assertRejects(() => client.run(req), ResponseError, 'HTTP 503')
      // Backoff is capped at a minute, and the waiting stops at the patience.
      assertEquals(pauses.at(-1), 60_000)
      assert(pauses.reduce((a, b) => a + b, 0) >= 600_000)
    }
  }
})
