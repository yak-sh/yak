// storeOf answers an eviction by taking a fresh stub and sending once more;
// anything else it throws through untouched.
import { assertEquals, assertRejects } from '@std/assert'
import { doorOf, evicted, type Namespace, storeOf } from './door.ts'
import { retry as retryWrite } from './write-log.ts'
import { counts, tallying } from './lib/hops.ts'
import { metaOf } from './meta.ts'

Deno.test('a request sums statement counts from each store response', async () => {
  let tally = new Map<string, number>()
  let next = 0
  await tallying(tally, async () => {
    let door = doorOf(() =>
      Promise.resolve(
        new Response('', {
          headers: {
            'x-yak-stmts': String(++next * 2),
            'x-yak-hops': '1',
          },
        }),
      ), 'jeff')
    await Promise.all([door('/query'), door('/query')])
  })
  assertEquals(tally.get('stmts'), 6)
  assertEquals(counts(tally).hops, 4)
})

let ns = (
  answers: Array<Error | string | Response>,
): Namespace & { seen: string[] } => {
  let seen: string[] = []
  return {
    seen,
    idFromName: (name) => name,
    get: () => ({
      fetch: async (req: Request) => {
        seen.push(await req.text())
        let next = answers.shift()
        if (next instanceof Error) throw next
        return next instanceof Response ? next : new Response(next ?? '')
      },
    }),
  }
}

let gone = () =>
  Object.assign(
    new Error(
      'Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.',
    ),
  )
let flagged = () => Object.assign(new Error('reset'), { retryable: true })
let storageTimeout = () =>
  new Error(
    'Durable Object storage operation exceeded timeout which caused object to be reset.',
  )

Deno.test('evicted: the runtime flag, or its words', () => {
  assertEquals(evicted(gone()), true)
  assertEquals(evicted(flagged()), true)
  assertEquals(evicted(storageTimeout()), true)
  assertEquals(evicted(new Error('boot failed')), false)
  assertEquals(evicted(null), false)
})

Deno.test('an evicted POST is sent again with its body intact', async () => {
  for (let reset of [gone(), storageTimeout()]) {
    let n = ns([reset, 'ok'])
    let res = await storeOf(n, 'jeff')('/apply', {
      method: 'POST',
      body: '[1]',
    })
    assertEquals(await res.text(), 'ok')
    assertEquals(n.seen, ['[1]', '[1]'])
  }
})

Deno.test('an interrupted recovery command is not silently sent again', async () => {
  let n = ns([storageTimeout(), Response.json({ writes: [] })])
  await assertRejects(
    () => retryWrite(storeOf(n, 'jeff'), 1),
    Error,
    'storage operation exceeded timeout',
  )
  assertEquals(n.seen.length, 1)
})

Deno.test('a bodiless GET retries once; a second eviction and other errors throw', async () => {
  let n = ns([flagged(), 'ok'])
  assertEquals(await (await storeOf(n, 'jeff')('/query')).text(), 'ok')
  assertEquals(n.seen.length, 2)
  await assertRejects(() => storeOf(ns([gone(), gone()]), 'jeff')('/query'))
  let other = ns([new Error('boot failed')])
  await assertRejects(() => storeOf(other, 'jeff')('/query'), Error, 'boot')
  assertEquals(other.seen.length, 1)
})

Deno.test('Store does not retry a streamed init or a Request with a body', async () => {
  for (let request of [false, true]) {
    let init = { method: 'POST', body: new Blob(['body']).stream() }
    let n = ns([flagged(), 'unexpected retry'])
    await assertRejects(() =>
      storeOf(n, 'jeff')(
        '/apply',
        request ? new Request('http://store/apply', init) : init,
      )
    )
    assertEquals(n.seen, ['body'])
  }
})

// A store the runtime resets mid-request can still answer, and says the reset
// as a refusal; that is the same eviction, and any other 500 is not.
Deno.test('an eviction a store answers is sent again; another 500 is its answer', async () => {
  let said = (message: string) =>
    Response.json({ error: 'Error', message }, { status: 500 })
  for (let reset of [gone(), storageTimeout()]) {
    let n = ns([said(reset.message), 'ok'])
    let res = await storeOf(n, 'jeff')('/apply', {
      method: 'POST',
      body: '[1]',
    })
    assertEquals(await res.text(), 'ok')
    assertEquals(n.seen, ['[1]', '[1]'])
  }
  let broke = ns([said('boot failed'), 'unexpected retry'])
  let no = await storeOf(broke, 'jeff')('/query')
  assertEquals([no.status, (await no.json()).message], [500, 'boot failed'])
  assertEquals(broke.seen.length, 1)
})

let brokenBody = (error: Error) => {
  let sent = false
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (sent) controller.error(error)
        else {
          sent = true
          controller.enqueue(new TextEncoder().encode('{"partial":'))
        }
      },
    }),
  )
}

Deno.test('a Store read retries a failed body, even after receiving bytes', async () => {
  let attempts = 0
  let store = storeOf({
    idFromName: (name) => name,
    get: () => ({
      fetch: () =>
        Promise.resolve(
          ++attempts == 1
            ? brokenBody(new Error('internal error; reference = abc123'))
            : Response.json([{ entity: { eid: 'kept' }, recipe: {} }]),
        ),
    }),
  }, 'recipes')
  assertEquals(await metaOf(store).query('.recipe'), [{
    entity: { eid: 'kept' },
    recipe: {},
  }])
  assertEquals(attempts, 2)
})

Deno.test('a Store write retries a failed body with the same key and body', async () => {
  let seen: [string, string | null][] = []
  let store = storeOf({
    idFromName: (name) => name,
    get: () => ({
      fetch: async (req) => {
        seen.push([await req.text(), req.headers.get('idempotency-key')])
        return seen.length == 1
          ? brokenBody(flagged())
          : Response.json({ saved: true })
      },
    }),
  }, 'recipes')
  assertEquals(
    await store.consume('/apply', (r) => r.json(), {
      method: 'POST',
      body: '[1]',
    }),
    { saved: true },
  )
  assertEquals(seen.length, 2)
  assertEquals(seen[0], seen[1])
})

Deno.test('an opaque body failure does not replay a Store write', async () => {
  let attempts = 0
  let store = storeOf({
    idFromName: (name) => name,
    get: () => ({
      fetch: () => {
        attempts++
        return Promise.resolve(
          brokenBody(new Error('internal error; reference = abc123')),
        )
      },
    }),
  }, 'recipes')
  await assertRejects(() =>
    store.consume('/apply', (r) => r.json(), {
      method: 'POST',
      body: '[1]',
    })
  )
  assertEquals(attempts, 1)
})
