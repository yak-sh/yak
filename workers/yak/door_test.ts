// storeOf answers an eviction by taking a fresh stub and sending once more;
// anything else it throws through untouched.
import { assertEquals, assertRejects } from '@std/assert'
import { evicted, type Namespace, storeOf } from './door.ts'

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

Deno.test('evicted: the runtime flag, or its words', () => {
  assertEquals(evicted(gone()), true)
  assertEquals(evicted(flagged()), true)
  assertEquals(evicted(new Error('boot failed')), false)
  assertEquals(evicted(null), false)
})

Deno.test('an evicted POST is sent again with its body intact', async () => {
  let n = ns([gone(), 'ok'])
  let res = await storeOf(n, 'jeff')('/apply', {
    method: 'POST',
    body: '[1]',
  })
  assertEquals(await res.text(), 'ok')
  assertEquals(n.seen, ['[1]', '[1]'])
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
  let n = ns([said(gone().message), 'ok'])
  let res = await storeOf(n, 'jeff')('/apply', { method: 'POST', body: '[1]' })
  assertEquals(await res.text(), 'ok')
  assertEquals(n.seen, ['[1]', '[1]'])
  let broke = ns([said('boot failed'), 'unexpected retry'])
  let no = await storeOf(broke, 'jeff')('/query')
  assertEquals([no.status, (await no.json()).message], [500, 'boot failed'])
  assertEquals(broke.seen.length, 1)
})
