// storeOf answers an eviction by taking a fresh stub and sending once more;
// anything else it throws through untouched.
import { assertEquals, assertRejects } from '@std/assert'
import { evicted, type Namespace, storeOf } from './door.ts'

let ns = (answers: Array<Error | string>): Namespace & { seen: string[] } => {
  let seen: string[] = []
  return {
    seen,
    idFromName: (name) => name,
    get: () => ({
      fetch: async (req: Request) => {
        seen.push(await req.text())
        let next = answers.shift()
        if (next instanceof Error) throw next
        return new Response(next ?? '')
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
